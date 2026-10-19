import {
  load_settings,
  save_setting,
  add_no_auto_pause_set,
  remove_no_auto_pause_set
} from "./interop";

type SettingStruct = {
    [key: string]: any;
    pauseBeforeSuspend: boolean;
    autoPause: boolean;
    overlayPause: boolean;
    noAutoPauseSet: Set<number>;
  };

  export class Settings {
    static default: SettingStruct = {
      pauseBeforeSuspend: false,
      autoPause: false,
      overlayPause: false,
      noAutoPauseSet: new Set(),
    } as const;

    static data: SettingStruct = Settings.default;

    static async init(): Promise<void> {
      await Settings.migrate();
      await Settings.loadAll();
    }

    static async loadAll(): Promise<void> {
      let data = await load_settings();
      for (let key in Settings.data) {
        if (key in data) {
          try {
            if (Settings.data[key] instanceof Set) {
              Settings.data[key] = new Set(data[key]);
            } else {
              Settings.data[key] = data[key];
            }
          } catch (e) { console.log(e); }
        }
      }

      Settings.saveAll();
    }

    static async save(key: keyof SettingStruct, value: any) {
      Settings.data[key] = value;

      if (value instanceof Set) {
        save_setting(key.toString(), [...value]);
      } else {
        save_setting(key.toString(), value);
      }
    }

    static async saveAll() {
      for (const k in Settings.data) {
        Settings.save(k as keyof SettingStruct, Settings.data[k as keyof SettingStruct]);
      }
    }

    static async migrate() {
      const LOCAL_STORAGE_KEY = "pause-games-settings";
      const strSettings = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (strSettings?.length) {
        try {
          let legacySettings = JSON.parse(strSettings) as SettingStruct;
          Settings.data = { ...Settings.data, ...legacySettings };
          Settings.saveAll();
        } catch (e) {}
        localStorage.removeItem(LOCAL_STORAGE_KEY);
      }
    }

    static async addNoAutoPauseSet(appid: number): Promise<void> {
      Settings.data.noAutoPauseSet.add(appid);
      return add_no_auto_pause_set(appid);
    }

    static async removeNoAutoPauseSet(appid: number): Promise<void> {
      Settings.data.noAutoPauseSet.delete(appid);
      return remove_no_auto_pause_set(appid);
    }
  }