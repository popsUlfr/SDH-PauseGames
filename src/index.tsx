import {
  definePlugin,
  PanelSection,
  PanelSectionRow,
  ServerAPI,
  staticClasses,
  ToggleField,
} from "decky-frontend-lib";
import { useEffect, useState, VFC } from "react";
import { FaStream, FaPlay, FaPause, FaMoon } from "react-icons/fa";
import { truncate } from "lodash";

import * as backend from "./backend";

const AppItem: VFC<{ app: backend.AppOverviewExt }> = ({ app }) => {
  const [isPaused, setIsPaused] = useState<boolean>(app.pausegames_is_paused);
  const [hasStickyPauseState, setHasStickyPauseState] = useState<boolean>(
    backend.getStickyPauseState(app.pausegames_instanceid)
  );

  return (
    <ToggleField
      checked={isPaused}
      key={app.appid}
      label={
        <div>
          {isPaused ? (
            <FaPause color={hasStickyPauseState ? "deepskyblue" : undefined} />
          ) : (
            <FaPlay color={hasStickyPauseState ? "deepskyblue" : undefined} />
          )}{" "}
          {truncate(app.display_name, { length: 18 })}
        </div>
      }
      tooltip={isPaused ? "Paused" : "Running"}
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
        if ((await backend.loadSettings()).autoPause) {
          backend.setStickyPauseState(app.pausegames_instanceid);
          setHasStickyPauseState(
            backend.getStickyPauseState(app.pausegames_instanceid)
          );
        }
      }}
    />
  );
};

const Content: VFC<{ serverAPI: ServerAPI }> = ({}) => {
  const [runningApps, setRunningApps] = useState<backend.AppOverviewExt[]>([]);
  const [pauseBeforeSuspend, setPauseBeforeSuspend] = useState<boolean>(false);
  const [autoPause, setAutoPause] = useState<boolean>(false);

  useEffect(() => {
    backend.loadSettings().then((s) => {
      setPauseBeforeSuspend(s.pauseBeforeSuspend);
      setAutoPause(s.autoPause);
    });
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
          tooltip="Pause all apps before suspend and resume those not explicitely paused."
          icon={<FaMoon />}
          onChange={async (state) => {
            const settings = await backend.loadSettings();
            settings.pauseBeforeSuspend = state;
            await backend.saveSettings(settings);
            setPauseBeforeSuspend(state);
          }}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <ToggleField
          checked={autoPause}
          label="Pause on focus loss"
          tooltip="Pauses apps not in focus when switching between them."
          icon={<FaStream />}
          onChange={async (state) => {
            const settings = await backend.loadSettings();
            settings.autoPause = state;
            await backend.saveSettings(settings);
            backend.resetStickyPauseStates();
            const runningApps = await backend.runningApps();
            setAutoPause(state);
            setRunningApps([]); // without this it won't update
            setRunningApps(runningApps);
          }}
        />
      </PanelSectionRow>
      {runningApps.length ? (
        runningApps.map((app) => (
          <PanelSectionRow key={app.appid}>
            <AppItem app={app} />
          </PanelSectionRow>
        ))
      ) : (
        <div>
          <strong>
            <em>- Pause before Suspend</em>
          </strong>
          <br />
          Pauses all apps before system suspend. May fix audio issues.
          <br />
          <strong>
            <em>- Pause on focus loss</em>
          </strong>
          <br />
          Pauses apps not in focus automatically when switching between them.
          Changing the state of an app in this mode will sticky them{" "}
          <FaPlay color="deepskyblue" />, <FaPause color="deepskyblue" />. To
          reset, disable and re-enable <em>Pause on focus loss</em>.
          <br />
          <strong>
            <em>Applications will appear here.</em>
          </strong>
        </div>
      )}
    </PanelSection>
  );
};

export default definePlugin((serverApi: ServerAPI) => {
  backend.setServerAPI(serverApi);

  const unregisterFocusChangeHandler = backend.setupFocusChangeHandler();
  const unregisterSuspendResumeHandler = backend.setupSuspendResumeHandler();

  return {
    title: <div className={staticClasses.Title}>Pause Games</div>,
    content: <Content serverAPI={serverApi} />,
    icon: <FaPause />,
    onDismount() {
      unregisterFocusChangeHandler();
      unregisterSuspendResumeHandler();
    },
  };
});
