interface GameSessionNotificationBase {
    unAppID: number;
}
interface AppLifetimeNotification extends GameSessionNotificationBase {
    nInstanceID: number;
    bRunning: boolean;
}