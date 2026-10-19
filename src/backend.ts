import {
  Router,
  AppOverview,
  sleep,
} from "@decky/ui";
import { debounce, throttle } from "lodash";
import {
  appid_from_pid,
  is_paused,
  pause,
  pid_from_appid,
  resume,
} from "./interop";
import { Settings } from "./settings";
import {
  //getResumeObservable,
  getSuspendResumeObservable,
} from "./sleep/suspendResumeObservables";

// only the needed subset of the SteamClient
declare var SteamClient: {
  GameSessions: {
    RegisterForAppLifetimeNotifications: (
      cb: (app: LifetimeNotificationExt) => void,
    ) => { unregister: () => void };
  };
  Apps: {
    RegisterForGameActionStart: (
      cb: (actionType: number, gameID: string, status: string) => void,
    ) => { unregister: () => void };
    RegisterForGameActionTaskChange: (
      cb: (
        actionType: number,
        gameID: string,
        action: string,
        status: string,
      ) => void,
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
      RegisterForSystemKeyEvents: (cb: (key: SystemKeyEvent) => void) => void;
    };
  };
  User: {
    RegisterForPrepareForSystemSuspendProgress: (
      cb: () => Promise<any> | void,
    ) => {
      unregister: () => void;
    };
    RegisterForResumeSuspendedGamesProgress: (
      cb: () => Promise<any> | void,
    ) => {
      unregister: () => void;
    };
  };
};

export interface SystemKeyEvent {
  eKey: number;
  nControllerIndex: number;
  nAppId: number;
}

// object passed to the callback of SteamClient.GameSessions.RegisterForAppLifetimeNotifications()
export interface LifetimeNotificationExt extends AppLifetimeNotification {
  unAppID: number; // Steam AppID, may be 0 if non-steam game
  nInstanceID: number; // PID of the running or killed process, it's the pid of the reaper for non-steam apps or of the first child if a steam app
  bRunning: boolean; // if the game is running or not
}

export interface AppOverviewExt extends AppOverview {
  appid: string; // base
  display_name: string; // base
  display_status: EDisplayStatus; // base
  sort_as: string; // base
  icon_data: string; // base, base64 encoded image
  icon_data_format: string; // base, image type without "image/" (e.g.: jpg, png)
  icon_hash: string; // base, url hash to fetch the icon for steam games (e.g.: "/assets/" + appid + "/" + icon_hash + ".jpg")
  m_gameid: string; // base, id for non-steam games
}

export interface AppOverviewExtPG {
  instanceid: number; // keep track of the pid of the reaper process
  is_paused: boolean; // keep track of a paused application
  last_pause_state: boolean; // keep track the state before suspend
  pause_state_callbacks: ((state: boolean) => void)[]; // pause state callbacks
  sticky_state: boolean; // keep track of the sticky state
  sticky_state_callbacks: ((state: boolean) => void)[]; // sticky state callbacks
}

interface FocusChangeEvent {
  rgFocusable: any[];
  focusedApp: {
    appid: number; // Steam AppID
    pid: number; // pid of the focused process
    strExeName: string; // name of the running executable getting focus e.g.: 'steamwebhelper' when not in a game, or something like 'Shadows Over Loathing.exe' when in game
    windowid: number; // window id number
  };
}

let appMetaDataMap: {
  [appid: number]: AppOverviewExtPG;
} = {};

// will be true if system will suspend
// and be false after system resume
let systemWillSuspend: boolean = false;

export async function getAppMetaData(appid: number) {
  if (appMetaDataMap[appid]) {
    return appMetaDataMap[appid];
  }
  const pid = await pid_from_appid(appid);
  return (appMetaDataMap[appid] = {
    instanceid: pid,
    is_paused: await is_paused(pid),
    pause_state_callbacks: [],
    last_pause_state: false,
    sticky_state: false,
    sticky_state_callbacks: [],
  });
}

export async function resumeApp(appid: number | string) {
  if (typeof appid === "string") {
    let id = BigInt(appid);
    if (id > BigInt(0xffffffff)) {
      // non-steam game
      // https://gaming.stackexchange.com/questions/386882/how-do-i-find-the-appid-for-a-non-steam-game-on-steam
      id = id / BigInt(2) ** BigInt(32);
    }
    appid = Number(id);
  }

  const appMD = await getAppMetaData(appid);
  appMD.is_paused = await is_paused(appMD.instanceid);
  if (appMD.is_paused && !appMD.last_pause_state) {
    appMD.is_paused = !(await resume(appMD.instanceid));
  }
}

export async function setStickyPauseState(appid: number) {
  const appMD = await getAppMetaData(appid);
  appMD.sticky_state = true;
  appMD.sticky_state_callbacks.forEach((cb) => cb(true));
}

export function resetStickyPauseState(appid: number) {
  const appMD = appMetaDataMap[appid];
  if (!appMD) return;
  appMD.sticky_state = false;
  appMD.sticky_state_callbacks.forEach((cb) => cb(false));
}

export function resetStickyPauseStates() {
  Object.values(appMetaDataMap).forEach((appMD) => {
    appMD.sticky_state = false;
    appMD.sticky_state_callbacks.forEach((cb) => cb(false));
  });
}

export function registerPauseStateChange(
  appid: number,
  cb: (state: boolean) => void,
) {
  getAppMetaData(appid).then((appMD) => {
    appMD.pause_state_callbacks.push(cb);
  });
  return () => {
    const appMD = appMetaDataMap[appid];
    if (!appMD) return;
    const i = appMD.pause_state_callbacks.findIndex((v) => v === cb);
    if (i >= 0) {
      appMD.pause_state_callbacks.splice(i, 1);
    }
  };
}

export function registerStickyPauseStateChange(
  appid: number,
  cb: (state: boolean) => void,
) {
  getAppMetaData(appid).then((appMD) => {
    appMD.sticky_state_callbacks.push(cb);
  });
  return () => {
    const appMD = appMetaDataMap[appid];
    if (!appMD) return;
    const i = appMD.sticky_state_callbacks.findIndex((v) => v === cb);
    if (i >= 0) {
      appMD.sticky_state_callbacks.splice(i, 1);
    }
  };
}

export function removeAppMetaData(appid: number) {
  resetStickyPauseState(appid);
  delete appMetaDataMap[appid];
}

export function cleanupAppMetaData() {
  const rApps = Router.RunningApps;
  const appids = Object.keys(appMetaDataMap).filter(
    (appid) => rApps.findIndex((a) => Number(a.appid) === Number(appid)) < 0,
  );
  appids.forEach((appid) => {
    removeAppMetaData(Number(appid));
  });
}

export function registerForRunningAppsChange(
  cb: (runningApps: AppOverviewExt[]) => void,
): () => void {
  const { unregister: unregisterGameActionTaskChange } =
    SteamClient.Apps.RegisterForGameActionTaskChange(
      async ({}, {}, {}, status: string | undefined) => {
        if (status !== "Completed") return;
        // at this point the application should be up and running
        return cb(Router.RunningApps as AppOverviewExt[]);
      },
    );
  const { unregister: unregisterAppLifetimeNotifications } =
    SteamClient.GameSessions.RegisterForAppLifetimeNotifications((app) => {
      if (app.bRunning) {
        cb(Router.RunningApps as AppOverviewExt[]);
      } else {
        sleep(500).then(() => {
          cleanupAppMetaData();
          cb(Router.RunningApps as AppOverviewExt[]);
        });
      }
    });

  return () => {
    unregisterGameActionTaskChange();
    unregisterAppLifetimeNotifications();
  };
}

export function setupSuspendResumeHandler(): () => void {
  const onSuspend = async () => {
    systemWillSuspend = true;
    if (!Settings.data.pauseBeforeSuspend) return;
    await Promise.all(
      (Router.RunningApps as AppOverviewExt[]).map(async (a) => {
        const appMD = await getAppMetaData(Number(a.appid));
        appMD.is_paused = await is_paused(appMD.instanceid);
        appMD.last_pause_state = appMD.is_paused;
        if (!appMD.is_paused) {
          appMD.is_paused = await pause(appMD.instanceid);
        }
        return a;
      }),
    );
  };

  const onResume = async () => {
    systemWillSuspend = false;
    if (!Settings.data.pauseBeforeSuspend) return;
    await Promise.all(
      (Router.RunningApps as AppOverviewExt[]).map(async (a) => {
        await resumeApp(Number(a.appid));
        return a;
      }),
    );
  };

  // const { unregister: unregisterOnSuspendRequest } =
  //   SteamClient.System.RegisterForOnSuspendRequest(onSuspend);
  // const { unregister: unregisterOnResumeFromSuspend } =
  //   SteamClient.System.RegisterForOnResumeFromSuspend(onResume);

  const suspendresumeObservable = getSuspendResumeObservable();
  //const resumeObservable = getResumeObservable();

  // Note: If newValue is TRUE then it's suspending, otherwise it's resuming.
  const unregisterOnSuspendRequest = suspendresumeObservable?.observe_((change) => {
    const { newValue } = change;
    console.log({ info: `PG-Suspending: mobX suspend triggered with ${newValue}` });
    if (!newValue) {
      return;
    }
    console.log({ info: `PG: Suspending Games (If toggle is enabled)...` });
    onSuspend();
  });

  const unregisterOnResumeFromSuspend = suspendresumeObservable?.observe_((change) => {
    const { newValue } = change;
    console.log({ info: `PG-Resuming: mobX suspend triggered with ${newValue}` });
    if (newValue) {
      return;
    }
    console.log({ info: `PG: Resuming Games (If toggle is enabled)...` });
    onResume();
  });

  return () => {
    unregisterOnSuspendRequest && unregisterOnSuspendRequest();
    unregisterOnResumeFromSuspend && unregisterOnResumeFromSuspend();
  };
}

export function setupFocusChangeHandler(): () => void {
  let appIsStartingUp: boolean = false;
  let lastPid = 0;
  let lastAppid = 0;
  let validKeyEvent: SystemKeyEvent | null = null;
  let keyEventFunction = (e: SystemKeyEvent) => {
    const cancelDebouncedEvent = debounce(() => {
      validKeyEvent = null;
    }, 1000);
    if (e.eKey === 0) {
      // Have not found any race condition issues with this approach since the key event fires long before focus change
      validKeyEvent = e;
      cancelDebouncedEvent();
    } else {
      cancelDebouncedEvent.cancel();
      validKeyEvent = null;
    }
  };
  const unregisterSystemKeyEvents = () => {
    keyEventFunction = () => {};
  };
  SteamClient.System.UI.RegisterForSystemKeyEvents((e) => keyEventFunction(e));

  const { unregister: unregisterFocusChangeEvents } =
    SteamClient.System.UI.RegisterForFocusChangeEvents(
      throttle(async (fce: FocusChangeEvent) => {
        // don't try anything while an application is launching or it could pause it midlaunch
        if (appIsStartingUp) {
          return;
        }
        // do nothing if system is suspending
        if (systemWillSuspend) {
          return;
        }
        // skip if we already got such an event before
        if (
          fce.focusedApp.pid === lastPid &&
          fce.focusedApp.appid === lastAppid &&
          !(validKeyEvent?.eKey === 0)
        ) {
          return;
        }
        lastPid = fce.focusedApp.pid;
        if (
          fce.focusedApp.appid === 769 &&
          lastAppid === 769 &&
          !(validKeyEvent?.eKey === 0)
        ) {
          return;
        }
        lastAppid = fce.focusedApp.appid;

        if (!Settings.data.autoPause) {
          return;
        }
        // AppID 769 is the Steam Overlay or a non-steam app
        // Key event must be if the user pressed the 'STEAM' button. Don't pause for other buttons
        const overlayPause =
          fce.focusedApp.appid === 769 &&
          validKeyEvent?.eKey === 0 &&
          Settings.data.overlayPause;
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
        await Promise.all(
          (Router.RunningApps as AppOverviewExt[]).map(async (a) => {
            if (Settings.data.noAutoPauseSet.has(Number(a.appid))) {
              return a;
            }
            const appMD = await getAppMetaData(Number(a.appid));
            // if the sticky pause state is on for this app don't do anything to it
            if (appMD.sticky_state) {
              return a;
            }
            appMD.is_paused = await is_paused(appMD.instanceid);
            if (!overlayPause && appMD.instanceid === fce.focusedApp.pid) {
              // this is the focused app
              if (appMD.is_paused) {
                appMD.is_paused = !(await resume(appMD.instanceid));
                appMD.pause_state_callbacks.forEach((cb) =>
                  cb(appMD.is_paused),
                );
              }
            } else {
              // the app is not in focus or the overlay is on
              if (!appMD.is_paused) {
                appMD.is_paused = await pause(appMD.instanceid);
                appMD.pause_state_callbacks.forEach((cb) =>
                  cb(appMD.is_paused),
                );
              }
            }
            return a;
          }),
        );
      }, 500),
    );

  const { unregister: unregisterGameActionTaskChange } =
    SteamClient.Apps.RegisterForGameActionTaskChange(
      async ({}, {}, {}, status: string | undefined) => {
        // this event will trigger multiple times during the startup of an application
        // as long as the status is not 'Completed' the app should be considered to be in startup mode
        appIsStartingUp = status !== "Completed";
      },
    );

  const { unregister: unregisterAppLifetimeNotifications } =
    SteamClient.GameSessions.RegisterForAppLifetimeNotifications((app) => {
      if (app.bRunning) return;
      // cleanup old sticky states
      // app.nInstanceID is the pid of the reaper for non-steam apps but the pid of the first child for steam apps
      // a sleep to cleanup once the running apps are updated
      sleep(500).then(cleanupAppMetaData);
    });

  return () => {
    unregisterSystemKeyEvents();
    unregisterFocusChangeEvents();
    unregisterGameActionTaskChange();
    unregisterAppLifetimeNotifications();
  };
}
