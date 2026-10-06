/** Build-296 mobile decoder settings characterized in game-config.py and the retained four-game build record. */
export const LOCAL_RECOMPILE_GAMES = ['fnaf1', 'fnaf2', 'fnaf3', 'fnaf4'] as const;
export type LocalRecompileGame = typeof LOCAL_RECOMPILE_GAMES[number];
interface Target { readonly package: string; readonly config: string; readonly oiXor: number; readonly loXor: number;
  readonly runtimePatches: readonly string[] }
const targets: Readonly<Record<LocalRecompileGame, Target>> = {
  fnaf1: { package: 'com.scottgames.fivenightsatfreddys', config: 'game-config.py', oiXor: 0, loXor: 0,
    runtimePatches: ['empty-path-start.patch'] },
  fnaf2: { package: 'com.scottgames.fnaf2', config: 'fnaf2-config.py', oiXor: 28, loXor: 48, runtimePatches: [] },
  fnaf3: { package: 'com.scottgames.fnaf3', config: 'game-config.py', oiXor: 29, loXor: 50, runtimePatches: [] },
  fnaf4: { package: 'com.scottgames.fnaf4', config: 'game-config.py', oiXor: 29, loXor: 62, runtimePatches: [] },
};
/** The selected game's parser and extension identities; independent of the host operating system. */
export const localRecompileTarget = (game: LocalRecompileGame) => targets[game];
