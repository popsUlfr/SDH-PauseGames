import {
  definePlugin,
  PanelSection,
  PanelSectionRow,
  Router,
  ServerAPI,
  sleep,
  staticClasses,
  ToggleField,
  AppOverview,
  DisplayStatus
} from "decky-frontend-lib";
import { useEffect, useState, VFC } from "react";
import { FaPause } from "react-icons/fa";

// only the needed subset of the SteamClient
declare var SteamClient: {
  GameSessions: {
    RegisterForAppLifetimeNotifications: (cb: (app: AppLifetimeObject) => void) => {unregister: () => void}
  }
};

// object passed to the callback of SteamClient.GameSessions.RegisterForAppLifetimeNotifications()
interface AppLifetimeObject {
  unAppID: number; // Steam AppID, may be 0 if non-steam game
  nInstanceID: number; // PID of the running or killed process
  bRunning: boolean; // if the game is running or not
}

interface AppOverviewExt extends AppOverview {
  appid: string; // base
  display_name: string; // base
  display_status: DisplayStatus; // base
  sort_as: string; // base
  icon_data: string; // base, base64 encoded image
  icon_data_format: string; // base, image type without "image/" (e.g.: jpg, png)
  icon_hash: string; // base, url hash to fetch the icon for steam games (e.g.: "/assets/" + appid + "_icon.jpg?v=" + icon_hash)
  m_gameid: string; // base, id for non-steam games
  instanceid: number; // an extension to keep track if the pid of the reaper process
  is_paused: boolean; // extension to keep track of a paused application
}

const Item: VFC<{ serverAPI: ServerAPI, app: AppOverviewExt }> = ({serverAPI, app}) => {
  const [isPaused, setIsPaused] = useState<boolean>(app.is_paused);

  return (
    <ToggleField checked={isPaused}
      key={app.appid}
      label={app.display_name}
      description={isPaused ? "Paused" : "Running"}
      disabled={!app.instanceid}
      icon={((app.icon_data && app.icon_data_format) || app.icon_hash) ? 
        <img style={{maxWidth: 32, maxHeight: 32}} src={(app.icon_data) ?
          ("data:image/" + app.icon_data_format + ";base64," + app.icon_data) :
            ("/assets/" + app.appid + "_icon.jpg?v=" + app.icon_hash) } /> :
          null}
      onChange={async (state) => {
        let ret = await serverAPI.callPluginMethod<{pid: number}, boolean>((state?"pause":"resume"), {pid: app.instanceid});
        if (!ret.success || !ret.result) {
          return;
        }
        ret = await serverAPI.callPluginMethod<{pid: number}, boolean>("is_paused", {pid: app.instanceid});
        if (ret.success) {
          app.is_paused = ret.result;
          setIsPaused(app.is_paused);
        }
      }}
      />
  );
};

const Content: VFC<{ serverAPI: ServerAPI }> = ({serverAPI}) => {
  const [runningApps, setRunningApps] = useState<AppOverviewExt[]>([]);

  useEffect(() => {
    const refresh = async (app: AppLifetimeObject) => {
      await sleep(100); // wait for a bit before going on
      const runningAppsTmp: AppOverviewExt[] = Router.RunningApps as AppOverviewExt[];
      const toKeep = await Promise.all(runningAppsTmp.map((async (a) => {
        // do not keep an instance that's going to die
        if (!app.bRunning && a.instanceid !== 0 && app.nInstanceID !== 0 && a.instanceid === app.nInstanceID) {
          return false;
        }
        if (!a.instanceid && app.nInstanceID !== 0 && Number(a.appid) !== 0 && app.unAppID !== 0 && Number(a.appid) === app.unAppID) {
          a.instanceid = app.nInstanceID;
        }
        if (!a.instanceid && Number(a.appid) !== 0) {
          // we may need to retry to get the pid since the process is still getting started
          for (let i = 0; i < 3; ++i) {
            const ret = await serverAPI.callPluginMethod<{appid: number}, number>("pid_from_appid", {appid: Number(a.appid)});
            if (ret.success && ret.result !== 0) {
              a.instanceid = ret.result;
              break;
            }
            await sleep(100);
          }
        }
        if (!a.appid && a.instanceid !== 0) {
          // retry for a bit until the process is up
          for (let i = 0; i < 3; ++i) {
            const ret = await serverAPI.callPluginMethod<{pid: number}, number>("appid_from_pid", {pid: a.instanceid});
            if (ret.success && ret.result !== 0) {
              a.appid = String(ret.result);
              break;
            }
            await sleep(100);
          }
        }
        if (!a.instanceid) {
          return true;
        }
        const ret = await serverAPI.callPluginMethod<{pid: number}, boolean>("is_paused", {pid: a.instanceid});
        if (ret.success) {
          a.is_paused = ret.result;
        }
        return true;
      })));
      const newRunningAppsTmp: AppOverviewExt[] = [];
      for (let i = 0; i < toKeep.length; ++i) {
        if (toKeep[i]) {
          newRunningAppsTmp.push(runningAppsTmp[i]);
        }
      }
      setRunningApps(newRunningAppsTmp);
    };
    refresh({unAppID: 0, nInstanceID: 0, bRunning: false});
    const {unregister} = SteamClient.GameSessions.RegisterForAppLifetimeNotifications(refresh);
    return () => {
      unregister();
    };
  }, []);

  return (
    <PanelSection>
      {runningApps.map((app) =>
      <PanelSectionRow key={app.appid}>
        <Item serverAPI={serverAPI} app={app} />
      </PanelSectionRow>
      )}
    </PanelSection>
  );
};

export default definePlugin((serverApi: ServerAPI) => {
  return {
    title: <div className={staticClasses.Title}>Pause Games</div>,
    content: <Content serverAPI={serverApi} />,
    icon: <FaPause />,
    onDismount() {

    },
  };
});
