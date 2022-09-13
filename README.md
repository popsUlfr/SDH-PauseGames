# Pause Games

A Steam Deck plugin for the [Decky Plugin Loader](https://github.com/SteamDeckHomebrew/decky-loader) that makes it possible to pause and resume games.

Useful for when you wish to temporarily suspend an application to redirect the cpu and gpu ressources to another without having to kill it.

It sends the `SIGSTOP` signal to all the children of the reaper process to stop the execution and `SIGCONT` to resume them. ([Signal (IPC)](https://en.wikipedia.org/wiki/Signal_(IPC)))

![](assets/20220913200428_1.jpg)

It also allows to pause all games prior to system suspend which seems to fix some issues with crackling audio or freezing emulators.

## Known Issues

- even without the plugin, multiple non-steam games behave weirdly and may not close correctly (or at least Steam gets stuck on the shutdown screen)

## Future ideas

- options to terminate and force kill more "thoroughly" and immediately a process tree
- checkpoint/restore support with [CRIU](https://github.com/checkpoint-restore/criu) to make it possible to dump and restore a game to/from disk (savestates)
  + I already conducted some experiments but the biggest hurdle are the sockets and dri devices which would require many interdependant processes to be checkpointed too
  + A completely isolated process and resource tree seems to be the only viable way currently to get something working (see podman/docker checkpoint/restore) but even then there are host only sockets (pipewire, wayland, xorg) that would need to be taken into account too for games to work
