export enum DOWNLOAD_ACTION {
  OPEN = 'open',
  PAUSE = 'pause',
  CANCEL = 'cancel',
  RESUME = 'resume',
  REMOVE = 'remove'
}

export enum DOWNLOAD_STATE {
  PROGRESSING = 'progressing',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  INTERRUPTED = 'interrupted',
  PAUSED = 'paused'
}
