declare module 'music-tempo' {
  export default class MusicTempo {
    tempo: string | number;
    beats: number[];
    constructor(audioData: Float32Array | number[], params?: Record<string, number>);
  }
}
