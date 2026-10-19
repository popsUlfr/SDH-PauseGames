import { callable } from "@decky/api"

export const is_paused = callable<[pid: number], boolean>("is_paused");
export const pause = callable<[pid: number], boolean>("pause");
export const resume = callable<[pid: number], boolean>("resume");
// export const terminate = callable<[pid: number], boolean>("terminate");
// export const kill = callable<[pid: number], boolean>("kill");
export const pid_from_appid = callable<[appid: number], number>("pid_from_appid");
export const appid_from_pid = callable<[pid: number], number>("appid_from_pid");
export const load_settings = callable<[], any>("load_settings");
export const save_setting = callable<[key: string, value: any], void>("save_setting");
export const add_no_auto_pause_set = callable<[appid: number], void>("add_no_auto_pause_set");
export const remove_no_auto_pause_set = callable<[appid: number], void>("remove_no_auto_pause_set");
