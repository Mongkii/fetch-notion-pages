type Task = () => Promise<any>;

interface IsDoneManager {
  promise: Promise<void>;
  setDone: () => void;
  setError: (e: any) => void;
}

const defaultIsDoneManager: IsDoneManager = {
  promise: Promise.resolve(),
  setDone: () => undefined,
  setError: () => undefined,
};

const REQUEST_INTERVAL_IN_MS = 1 * 1000;

export class TaskManager {
  private _maxTasksInOneSec: number;
  private _doTasksTimer: NodeJS.Timer | undefined;

  private _sessionId: Symbol | undefined;
  private _isStarted = false;
  private _isDoneManager: IsDoneManager = defaultIsDoneManager;

  private _doingTasks = new Set<Promise<any>>();
  private _undoneTasks: Task[] = [];

  constructor(maxTasksInOneSec: number) {
    this._maxTasksInOneSec = maxTasksInOneSec;
  }

  start() {
    if (this._isStarted) {
      console.log('taskManager is already started!');
      return;
    }

    this._sessionId = Symbol();
    this._isStarted = true;

    const isDoneManager: Partial<IsDoneManager> = {};
    isDoneManager.promise = new Promise((resolve, reject) => {
      isDoneManager.setDone = resolve;
      isDoneManager.setError = reject;
    });
    this._isDoneManager = isDoneManager as IsDoneManager;

    this._doTasksTimer = setInterval(() => this._doTasks(), REQUEST_INTERVAL_IN_MS);
  }

  private _endTasks(type: 'success'): void;
  private _endTasks(type: 'error', e: any): void;
  private _endTasks(type: 'success' | 'error', e?: any) {
    if (type === 'success') {
      this._isDoneManager.setDone();
    } else {
      this._isDoneManager.setError(e);
    }

    clearInterval(this._doTasksTimer);
    this._doTasksTimer = undefined;

    this._sessionId = undefined;
    this._isStarted = false;
    this._isDoneManager = defaultIsDoneManager;

    this._doingTasks.clear();
    this._undoneTasks = [];
  }

  private _isValidSession(sessionId: Symbol | undefined) {
    return this._sessionId === sessionId;
  }

  private _doTasks() {
    if (this._doingTasks.size < 1 && this._undoneTasks.length < 1) {
      this._endTasks('success');
      return;
    }

    if (this._undoneTasks.length < 1) {
      return;
    }

    const newTasksToDone = this._undoneTasks.slice(0, this._maxTasksInOneSec);
    this._undoneTasks = this._undoneTasks.slice(this._maxTasksInOneSec);

    const curSessionId = this._sessionId;

    newTasksToDone.forEach((task) => {
      const promise = task();
      this._doingTasks.add(promise);

      promise
        .then(() => {
          if (!this._isValidSession(curSessionId)) {
            return;
          }
          this._doingTasks.delete(promise);

          if (this._doingTasks.size < 1 && this._undoneTasks.length < 1) {
            this._endTasks('success');
          }
        })
        .catch((e) => {
          if (!this._isValidSession(curSessionId)) {
            return;
          }
          this._endTasks('error', e);
        });
    });
  }

  addTask(task: Task) {
    this._undoneTasks.push(task);
  }

  isDone() {
    return this._isDoneManager.promise;
  }
}
