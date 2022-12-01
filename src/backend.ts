import {
  Router,
  ServerAPI,
  AppOverview,
  DisplayStatus,
  sleep,
  LifetimeNotification,
} from "decky-frontend-lib";
import { throttle } from "lodash";

const LOCAL_STORAGE_KEY = "pause-games-settings";

// only the needed subset of the SteamClient
declare var SteamClient: {
  GameSessions: {
    RegisterForAppLifetimeNotifications: (
      cb: (app: LifetimeNotificationExt) => void
    ) => { unregister: () => void };
  };
  Apps: {
    RegisterForGameActionStart: (
      cb: (actionType: number, gameID: string, status: string) => void
    ) => { unregister: () => void };
    RegisterForGameActionTaskChange: (
      cb: (
        actionType: number,
        gameID: string,
        action: string,
        status: string
      ) => void
    ) => { unregister: () => void };
  };
  System: {
    RegisterForOnSuspendRequest: (cb: () => Promise<any> | void) => {
      unregister: () => void;
    };
    RegisterForOnResumeFromSuspend: (cb: () => Promise<any> | void) => {
      unregister: () => void;
    };
    UI: {
      // careful it's firing a lot in intervals, should be throttled
      RegisterForFocusChangeEvents: (cb: (fce: FocusChangeEvent) => void) => {
        unregister: () => void;
      };
    };
  };
};

// object passed to the callback of SteamClient.GameSessions.RegisterForAppLifetimeNotifications()
export interface LifetimeNotificationExt extends LifetimeNotification {
  unAppID: number; // Steam AppID, may be 0 if non-steam game
  nInstanceID: number; // PID of the running or killed process, it's the pid of the reaper not the first child
  bRunning: boolean; // if the game is running or not
  pausegames_gameID: string; // extension
}

export interface AppOverviewExt extends AppOverview {
  appid: string; // base
  display_name: string; // base
  display_status: DisplayStatus; // base
  sort_as: string; // base
  icon_data: string; // base, base64 encoded image
  icon_data_format: string; // base, image type without "image/" (e.g.: jpg, png)
  icon_hash: string; // base, url hash to fetch the icon for steam games (e.g.: "/assets/" + appid + "_icon.jpg?v=" + icon_hash)
  m_gameid: string; // base, id for non-steam games
  pausegames_instanceid: number; // an extension to keep track of the pid of the reaper process
  pausegames_is_paused: boolean; // extension to keep track of a paused application
  pausegames_last_pause_state: boolean; // extension to keep track the state before suspend
}

interface FocusChangeEvent {
  focusedApp: {
    appid: number; // Steam AppID
    pid: number; // pid of the focused process
    strExeName: string; // name of the running executable getting focus e.g.: 'steamwebhelper' when not in a game, or something like 'Shadows Over Loathing.exe' when in game
    windowid: number; // window id number
  };
}

export interface Settings {
  pauseBeforeSuspend: boolean;
  autoPause: boolean;
}
export const NullSettings: Settings = {
  pauseBeforeSuspend: false,
  autoPause: false,
} as const;

var serverAPI: ServerAPI | undefined = undefined;

export function setServerAPI(s: ServerAPI) {
  serverAPI = s;
}

async function backend_call<I, O>(name: string, params: I): Promise<O> {
  try {
    const res = await serverAPI!.callPluginMethod<I, O>(name, params);
    if (res.success) return res.result;
    else {
      console.error(res.result);
      throw res.result;
    }
  } catch (e) {
    console.error(e);
    throw e;
  }
}

export async function is_paused(pid: number): Promise<boolean> {
  return backend_call<{ pid: number }, boolean>("is_paused", { pid });
}

export async function pause(pid: number): Promise<boolean> {
  return backend_call<{ pid: number }, boolean>("pause", { pid });
}

export async function resume(pid: number): Promise<boolean> {
  return backend_call<{ pid: number }, boolean>("resume", { pid });
}

export async function terminate(pid: number): Promise<boolean> {
  return backend_call<{ pid: number }, boolean>("terminate", { pid });
}

export async function kill(pid: number): Promise<boolean> {
  return backend_call<{ pid: number }, boolean>("kill", { pid });
}

export async function pid_from_appid(appid: number): Promise<number> {
  return backend_call<{ appid: number }, number>("pid_from_appid", { appid });
}

export async function appid_from_pid(pid: number): Promise<number> {
  return backend_call<{ pid: number }, number>("appid_from_pid", { pid });
}

export async function loadSettings(): Promise<Settings> {
  const strSettings = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (strSettings?.length) {
    try {
      return JSON.parse(strSettings) as Settings;
    } catch (e) {}
  }
  return { ...NullSettings };
}

export async function saveSettings(s: Settings): Promise<void> {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(s));
}

export async function runningApps(): Promise<AppOverviewExt[]> {
  return Promise.all(
    (Router.RunningApps as AppOverviewExt[]).map(async (a) => {
      if (!a.pausegames_instanceid && Number(a.appid || 0) !== 0) {
        const pid = await pid_from_appid(Number(a.appid));
        if (pid !== 0) {
          a.pausegames_instanceid = pid;
        }
      }
      if (a.pausegames_instanceid) {
        a.pausegames_is_paused = await is_paused(a.pausegames_instanceid);
      } else {
        a.pausegames_is_paused = false;
      }
      return a;
    })
  );
}

let stickyPauseStateMap: {
  [index: number]: boolean;
} = {};

export function setStickyPauseState(pid: number) {
  stickyPauseStateMap[pid] = true;
}

export function removeStickyPauseState(pid: number) {
  delete stickyPauseStateMap[pid];
}

export function getStickyPauseState(pid: number) {
  return stickyPauseStateMap[pid];
}

export function resetStickyPauseStates() {
  stickyPauseStateMap = {};
}

let runningAppsChangeCallback: (
  runningApps: AppOverviewExt[]
) => void = () => {};

export function registerForRunningAppsChange(
  cb: (runningApps: AppOverviewExt[]) => void
): () => void {
  const { unregister: unregisterGameActionTaskChange } =
    SteamClient.Apps.RegisterForGameActionTaskChange(
      async ({}, {}, {}, status: string | undefined) => {
        if (status !== "Completed") return;
        // at this point the application should be up and running
        const runningApps: AppOverviewExt[] = await Promise.all(
          (Router.RunningApps as AppOverviewExt[]).map(async (a) => {
            if (!a.pausegames_instanceid && Number(a.appid || 0) !== 0) {
              for (let i = 0; i < 6; i++) {
                const pid = await pid_from_appid(Number(a.appid));
                if (pid !== 0) {
                  a.pausegames_instanceid = pid;
                  break;
                }
                await sleep(100);
              }
            }
            if (Number(a.appid || 0) === 0 && a.pausegames_instanceid) {
              const appid = await appid_from_pid(a.pausegames_instanceid);
              if (appid !== 0) {
                a.appid = String(appid);
              }
            }
            if (a.pausegames_instanceid) {
              a.pausegames_is_paused = await is_paused(a.pausegames_instanceid);
            }
            return a;
          })
        );
        return cb(runningApps);
      }
    );
  const { unregister: unregisterAppLifetimeNotifications } =
    SteamClient.GameSessions.RegisterForAppLifetimeNotifications((app) => {
      if (app.bRunning) {
        const fApp = (Router.RunningApps as AppOverviewExt[]).find(
          (a) =>
            (a.pausegames_instanceid &&
              app.nInstanceID &&
              a.pausegames_instanceid === app.nInstanceID) ||
            (Number(a.appid || 0) !== 0 &&
              app.unAppID &&
              Number(a.appid || 0) === app.unAppID) ||
            (a.m_gameid &&
              a.m_gameid !== "0" &&
              app.pausegames_gameID &&
              app.pausegames_gameID !== "0" &&
              a.m_gameid === app.pausegames_gameID)
        );
        if (fApp) {
          if (Number(fApp.appid || 0) === 0 && app.unAppID !== 0) {
            fApp.appid = String(app.unAppID);
          }
          if (app.pausegames_gameID && app.pausegames_gameID !== "0") {
            fApp.m_gameid = app.pausegames_gameID;
          }
          if (app.nInstanceID) {
            // nInstanceID is the pid of the reaper process which holds the AppID command line flag
            fApp.pausegames_instanceid = app.nInstanceID;
          }
        }
      } else {
        const runningApps: AppOverviewExt[] = [];
        (Router.RunningApps as AppOverviewExt[]).forEach((a) => {
          if (
            (a.pausegames_instanceid &&
              app.nInstanceID &&
              a.pausegames_instanceid === app.nInstanceID) ||
            (Number(a.appid || 0) !== 0 &&
              app.unAppID &&
              Number(a.appid) === app.unAppID) ||
            (a.m_gameid &&
              a.m_gameid !== "0" &&
              app.pausegames_gameID &&
              app.pausegames_gameID !== "0" &&
              a.m_gameid === app.pausegames_gameID)
          ) {
            return;
          }
          runningApps.push(a);
        });
        cb(runningApps);
      }
    });

  runningAppsChangeCallback = cb;
  return () => {
    runningAppsChangeCallback = () => {};
    unregisterGameActionTaskChange();
    unregisterAppLifetimeNotifications();
  };
}

export function setupSuspendResumeHandler(): () => void {
  let lastRunningApps: AppOverviewExt[] = [];

  const { unregister: unregisterOnSuspendRequest } =
    SteamClient.System.RegisterForOnSuspendRequest(async () => {
      if (!(await loadSettings()).pauseBeforeSuspend) return;
      lastRunningApps = await Promise.all(
        (Router.RunningApps as AppOverviewExt[]).map(async (a) => {
          if (!a.pausegames_instanceid && Number(a.appid || 0) !== 0) {
            const pid = await pid_from_appid(Number(a.appid));
            if (pid !== 0) {
              a.pausegames_instanceid = pid;
            }
          }
          if (!a.pausegames_instanceid) {
            return a;
          }
          a.pausegames_is_paused = await is_paused(a.pausegames_instanceid);
          a.pausegames_last_pause_state = a.pausegames_is_paused;
          if (!a.pausegames_is_paused) {
            await pause(a.pausegames_instanceid);
          }
          return a;
        })
      );
    });

  const { unregister: unregisterOnResumeFromSuspend } =
    SteamClient.System.RegisterForOnResumeFromSuspend(async () => {
      if (!(await loadSettings()).pauseBeforeSuspend) return;
      await Promise.all(
        lastRunningApps.map(async (a) => {
          if (!a.pausegames_instanceid && Number(a.appid || 0) !== 0) {
            const pid = await pid_from_appid(Number(a.appid));
            if (pid !== 0) {
              a.pausegames_instanceid = pid;
            }
          }
          if (!a.pausegames_instanceid) {
            return;
          }
          a.pausegames_is_paused = await is_paused(a.pausegames_instanceid);
          if (a.pausegames_is_paused && !a.pausegames_last_pause_state) {
            await resume(a.pausegames_instanceid);
          }
        })
      );
      lastRunningApps = [];
    });

  return () => {
    unregisterOnSuspendRequest();
    unregisterOnResumeFromSuspend();
  };
}

export function setupFocusChangeHandler(): () => void {
  let appIsStartingUp: boolean = false;
  let lastPid = 0;
  const { unregister: unregisterFocusChangeEvents } =
    SteamClient.System.UI.RegisterForFocusChangeEvents(
      throttle(async (fce: FocusChangeEvent) => {
        // don't try anything while an application is launching or it could pause it midlaunch
        if (appIsStartingUp) return;
        // skip if we already got such an event before
        if (fce.focusedApp.pid === lastPid) return;
        lastPid = fce.focusedApp.pid;
        if (!(await loadSettings()).autoPause) return;
        // AppID 769 is the Steam Overlay or a non-steam app
        if (!fce.focusedApp.appid || fce.focusedApp.appid === 769) {
          const appid = await appid_from_pid(fce.focusedApp.pid);
          if (appid) {
            fce.focusedApp.appid = appid;
          } else {
            return;
          }
        }
        // fce.focusedApp.pid is not the pid of the reaper but of the first child
        const pid = await pid_from_appid(fce.focusedApp.appid);
        if (pid) {
          fce.focusedApp.pid = pid;
        } else {
          return;
        }
        let hasStateChange: boolean = false;
        const runningApps = await Promise.all(
          (Router.RunningApps as AppOverviewExt[]).map(async (a) => {
            if (!a.pausegames_instanceid && Number(a.appid || 0) !== 0) {
              const pid = await pid_from_appid(Number(a.appid));
              if (pid !== 0) {
                a.pausegames_instanceid = pid;
              }
            }
            if (!a.pausegames_instanceid) {
              return a;
            }
            // if the sticky pause state is on for this app don't do anything to it
            if (getStickyPauseState(a.pausegames_instanceid)) {
              return a;
            }
            a.pausegames_is_paused = await is_paused(a.pausegames_instanceid);
            if (a.pausegames_instanceid === fce.focusedApp.pid) {
              // this is the focused app
              if (a.pausegames_is_paused) {
                a.pausegames_is_paused = !(await resume(
                  a.pausegames_instanceid
                ));
                hasStateChange = true;
              }
            } else {
              // the app is not in focus
              if (!a.pausegames_is_paused) {
                a.pausegames_is_paused = await pause(a.pausegames_instanceid);
                hasStateChange = true;
              }
            }
            return a;
          })
        );
        if (hasStateChange) {
          runningAppsChangeCallback(runningApps);
        }
      }, 500)
    );

  const { unregister: unregisterGameActionTaskChange } =
    SteamClient.Apps.RegisterForGameActionTaskChange(
      async ({}, {}, {}, status: string | undefined) => {
        // this event will trigger multiple times during the startup of an application
        // as long as the status is not 'Completed' the app should be considered to be in startup mode
        appIsStartingUp = status !== "Completed";
      }
    );

  const { unregister: unregisterAppLifetimeNotifications } =
    SteamClient.GameSessions.RegisterForAppLifetimeNotifications((app) => {
      if (app.bRunning) return;
      // cleanup old sticky states
      removeStickyPauseState(app.nInstanceID);
    });

  return () => {
    unregisterFocusChangeEvents();
    unregisterGameActionTaskChange();
    unregisterAppLifetimeNotifications();
  };
}
