/// <reference types="vite/client" />

interface Window {
  /** Dev builds only: the running game, for the console and scripted playtests. */
  __kira?: import('./Game').Game;
  /** Dev builds only: the effects layer, for triggering effects by hand. */
  __kiraFx?: import('../render/ThreeFx').ThreeFx;
}
