declare module 'pidusage' {
  interface PidusageStats {
    cpu: number;
    memory: number;
    ctime: number;
    elapsed: number;
    timestamp: number;
    pid: number;
    ppid: number;
  }
  function pidusage(pid: number): Promise<PidusageStats>;
  export default pidusage;
}
