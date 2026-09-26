declare module '*.css';

declare module '@univerjs/preset-sheets-core/worker?worker&url' {
  const workerURL: string;
  export default workerURL;
}
