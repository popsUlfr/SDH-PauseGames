import {
  beforePatch,
  Button,
  Field,
  Focusable,
  Marquee,
  PanelSection,
  PanelSectionRow,
  Router,
  Toggle,
  ToggleField,
} from "@decky/ui";
import { definePlugin } from "@decky/api";
import { useEffect, useState } from "react";
import { FaStream, FaPlay, FaPause, FaMoon } from "react-icons/fa";

import * as backend from "./backend";
import { pause, resume } from "./interop";
import { Settings } from "./settings";

function AppItem({app, autoPause}: {app: backend.AppOverviewExt, autoPause: boolean}) {
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [hasStickyPauseState, setHasStickyPauseState] = useState<boolean>(false);
  const [inNoAutoPauseSet, setInNoAutoPauseSet] = useState<boolean>(
    Settings.data.noAutoPauseSet.has(Number(app.appid))
  )

  useEffect(() => {
    backend.getAppMetaData(Number(app.appid)).then((appMD) => {
      setIsPaused(appMD.is_paused);
      setHasStickyPauseState(appMD.sticky_state);
    });
    setInNoAutoPauseSet(Settings.data.noAutoPauseSet.has(Number(app.appid)));
    const unregisterPauseStateChange = backend.registerPauseStateChange(
      Number(app.appid), setIsPaused
    );
    const unregisterStickyPauseStateChange = backend.registerStickyPauseStateChange(
      Number(app.appid), setHasStickyPauseState
    );
    return () => {
      unregisterPauseStateChange();
      unregisterStickyPauseStateChange();
    };
  }, []);

  const onClickPauseButton = async () => {
    {
      const appMD = await backend.getAppMetaData(Number(app.appid));
      if (
        !(await (isPaused
          ? resume(appMD.instanceid)
          : pause(appMD.instanceid)))
      ) {
        return;
      }
      appMD.is_paused = !isPaused;
      setIsPaused(!isPaused);
      if (Settings.data.autoPause) {
        if (hasStickyPauseState) {
          backend.resetStickyPauseState(Number(app.appid));
          setHasStickyPauseState(false);
        } else {
          backend.setStickyPauseState(Number(app.appid));
          setHasStickyPauseState(true);
        }
      }
    }
  };

  const getAppIcon = (app: backend.AppOverviewExt) => {
    let iconUrl;
    if (app.icon_data && app.icon_data_format) {
      iconUrl = `data:image/${app.icon_data_format};base64,${app.icon_data}`;
    } else if (app.icon_hash) {
      iconUrl = `/assets/${app.appid}/${app.icon_hash}.jpg`;
    } else {
      return "none";
    }

    return `linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.4)), url(${iconUrl})`;
  }

  return (
    <Field
      spacingBetweenLabelAndChild="none"
      childrenLayout="inline"
      childrenContainerWidth="max">
    <Focusable
      style={{
        display: "flex",
        alignItems: "center",
        paddingLeft: "2px"}}>
      <Button
          style={{
            width: "48px",
            height: "48px",
            border: "none",
            background: "none",
            padding: "0",}}
          onClick={(_) => onClickPauseButton()}
          onOKButton={() => onClickPauseButton()}>
        {
          <div style={{
            background: getAppIcon(app),
            backgroundSize: "cover",
            width: "inherit",
            height: "inherit",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "2px",
          }}>
            {isPaused ? (
              <FaPlay color={hasStickyPauseState ? "deepskyblue" : "white"} />
            ) : (
              <FaPause color={hasStickyPauseState ? "deepskyblue" : "white"} />
            )}
          </div>
        }
      </Button>
      <div
        style={{
          minWidth: "0",
          width: "0",
          flex: "1 1 0",
          paddingRight: "8px",}}>
        <Marquee style={{
          paddingLeft: "8px",}}>
          {app.display_name}
        </Marquee>
      </div>
      {autoPause && (
        <Toggle
          value={!inNoAutoPauseSet}
          onChange={async (state) => {
            setInNoAutoPauseSet(!state);
            if (state) {
              Settings.removeNoAutoPauseSet(Number(app.appid));
            } else {
              Settings.addNoAutoPauseSet(Number(app.appid));
            }
          }}
        />
      )}
    </Focusable>
    </Field>
  );
};

function Content() {
  const [runningApps, setRunningApps] = useState<backend.AppOverviewExt[]>(
    Router.RunningApps as backend.AppOverviewExt[]
  );
  const [pauseBeforeSuspend, setPauseBeforeSuspend] = useState<boolean>(Settings.data.pauseBeforeSuspend);
  const [autoPause, setAutoPause] = useState<boolean>(Settings.data.autoPause);
  const [overlayPause, setOverlayPause] = useState<boolean>(Settings.data.overlayPause);

  useEffect(() => {
    const unregisterRunningAppsChange = backend.registerForRunningAppsChange(
      (runningApps: backend.AppOverviewExt[]) => {
        setRunningApps(runningApps);
      }
    );
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
            setPauseBeforeSuspend(state);
            await Settings.save("pauseBeforeSuspend", state);
          }}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <ToggleField
          bottomSeparator={autoPause ? "none" : "standard"}
          checked={autoPause}
          label="Pause on focus loss"
          tooltip="Pauses apps not in focus when switching between them."
          icon={<FaStream />}
          onChange={async (state) => {
            setAutoPause(state);
            backend.resetStickyPauseStates();
            await Settings.save("autoPause", state);
          }}
        />
      </PanelSectionRow>
      {autoPause && (
        <PanelSectionRow>
          <ToggleField
            checked={overlayPause}
            label=" ↳ Also on overlay"
            tooltip="Pause apps when interacting with Steam Overlay."
            onChange={async (state) => {
              setOverlayPause(state);
              await Settings.save("overlayPause", state);
            }}
            disabled={!autoPause}
          />
        </PanelSectionRow>
      )}
      {runningApps.length ? (
        runningApps.map((app) => (
          <PanelSectionRow key={app.appid}>
            <AppItem app={app} autoPause={autoPause} />
          </PanelSectionRow>
        ))
      ) : (
        <div style={{ fontSize: "80%" }}>
          <strong>
            <em>- Pause before Suspend</em>
          </strong>
          <br />
          Pauses all apps before system suspend.
          <br />
          May fix audio issues.
          <br />
          <strong>
            <em>- Pause on focus loss</em>
          </strong>
          <br />
          Automatically pauses apps not in focus while switching between them.
          Manually setting the state of an app in this mode will sticky them{" "}
          <FaPlay color="deepskyblue" /> <FaPause color="deepskyblue" /> until
          they are manually changed back.
          <br />
          <strong>
            <em>- Also on overlay</em>
          </strong>
          <br />
          Additionally pauses apps while interacting with the Steam Overlay.
          <br />
          <strong>
            <em>Applications will appear here.</em>
          </strong>
          <br />
          To manually pause/resume the apps, press the apps icon.
          <br />
        </div>
      )}
    </PanelSection>
  );
};

export default definePlugin(() => {
  Settings.init();
  let patch = beforePatch(SteamClient.Apps, "TerminateApp", (inputs: any[]) => {
      backend?.resumeApp?.(inputs[0]);
  });

  const unregisterFocusChangeHandler = backend.setupFocusChangeHandler();
  const unregisterSuspendResumeHandler = backend.setupSuspendResumeHandler();

  return {
    name: "Pause Games",
    content: <Content />,
    icon: <FaPause />,
    onDismount() {
      patch.unpatch();
      unregisterFocusChangeHandler();
      unregisterSuspendResumeHandler();
    },
  };
});
