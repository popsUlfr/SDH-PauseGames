import {
  definePlugin,
  PanelSection,
  PanelSectionRow,
  ServerAPI,
  staticClasses,
  ToggleField,
} from "decky-frontend-lib";
import { useEffect, useState, VFC } from "react";
import { FaPause, FaMoon } from "react-icons/fa";

import * as backend from "./backend";

const AppItem: VFC<{ app: backend.AppOverviewExt }> = ({ app }) => {
  const [isPaused, setIsPaused] = useState<boolean>(app.pausegames_is_paused);

  return (
    <ToggleField
      checked={isPaused}
      key={app.appid}
      label={app.display_name}
      description={isPaused ? "Paused" : "Running"}
      disabled={!app.pausegames_instanceid}
      icon={
        (app.icon_data && app.icon_data_format) || app.icon_hash ? (
          <img
            style={{ maxWidth: 32, maxHeight: 32 }}
            src={
              app.icon_data
                ? "data:image/" +
                  app.icon_data_format +
                  ";base64," +
                  app.icon_data
                : "/assets/" + app.appid + "_icon.jpg?v=" + app.icon_hash
            }
          />
        ) : null
      }
      onChange={async (state) => {
        if (
          !(await (state
            ? backend.pause(app.pausegames_instanceid)
            : backend.resume(app.pausegames_instanceid)))
        ) {
          return;
        }
        app.pausegames_is_paused = await backend.is_paused(
          app.pausegames_instanceid
        );
        setIsPaused(app.pausegames_is_paused);
      }}
    />
  );
};

const Content: VFC<{ serverAPI: ServerAPI }> = ({}) => {
  const [runningApps, setRunningApps] = useState<backend.AppOverviewExt[]>([]);
  const [pauseBeforeSuspend, setPauseBeforeSuspend] = useState<boolean>(false);

  useEffect(() => {
    backend
      .loadSettings()
      .then((s) => setPauseBeforeSuspend(s.pauseBeforeSuspend));
    const unregisterRunningAppsChange = backend.registerForRunningAppsChange(
      (runningApps: backend.AppOverviewExt[]) => {
        setRunningApps(runningApps);
      }
    );
    backend.runningApps().then((runningApps) => setRunningApps(runningApps));
    return () => {
      unregisterRunningAppsChange();
    };
  }, []);

  return (
    <PanelSection>
      <PanelSectionRow>
        <ToggleField
          checked={pauseBeforeSuspend}
          label="Pause before Suspend"
          description="Pause all games before suspend and resume those not explicitely paused."
          icon={<FaMoon />}
          onChange={(state) => {
            backend.saveSettings({ pauseBeforeSuspend: state });
            setPauseBeforeSuspend(state);
          }}
        />
      </PanelSectionRow>
      {runningApps.length
        ? runningApps.map((app) => (
            <PanelSectionRow key={app.appid}>
              <AppItem app={app} />
            </PanelSectionRow>
          ))
        : "Started applications that can be paused will appear in here."}
    </PanelSection>
  );
};

export default definePlugin((serverApi: ServerAPI) => {
  backend.setServerAPI(serverApi);

  const unregisterSuspendResumeHandler = backend.setupSuspendResumeHandler();

  return {
    title: <div className={staticClasses.Title}>Pause Games</div>,
    content: <Content serverAPI={serverApi} />,
    icon: <FaPause />,
    onDismount() {
      unregisterSuspendResumeHandler();
    },
  };
});
