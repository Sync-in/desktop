import { getLogger } from './loggers'
import { setTimeout } from 'timers/promises'
import { TRANSFER_MIN_SIZE } from '../constants/handlers'
import type { Logger } from 'winston'
import type { SyncTransferContext } from '../interfaces/sync-transfer.interface'
import { capitalize } from '../utils/functions'

type Task = () => Promise<void>

interface Queue {
  concurrency: number
  items: Task[]
  count: number
  isDone?: boolean
}

export class TasksManager {
  private readonly logger: Logger
  private readonly queues: Record<string, Queue>
  private endQueue: Task[] = []
  private endFilling = false
  private stopped = false

  constructor(sync: SyncTransferContext) {
    this.logger = getLogger('Tasks', sync)

    this.queues = {
      fast: { concurrency: 3, items: [], count: 0 },
      slow: { concurrency: 1, items: [], count: 0, isDone: false },
      props: { concurrency: 2, items: [], count: 0 }
    }
  }

  async run(): Promise<void> {
    const allPipes = Object.entries(this.queues).flatMap(([name, queue]) =>
      Array.from({ length: queue.concurrency }, (_, i) => this.queuePipe(name as keyof typeof this.queues, i))
    )
    await Promise.all(allPipes)
    this.logger.debug('All queues are done')
  }

  private async queuePipe(type: keyof typeof this.queues, id: number): Promise<void> {
    const queue = this.queues[type]

    while (!this.stopped) {
      // Handle the main task queue
      if (queue.count > 0) {
        const task = queue.items.shift()
        if (task) {
          try {
            await task()
          } catch (error) {
            this.logger.error(error)
          } finally {
            queue.count--
          }
          continue
        }
      }

      // handle end queue transfer to fast queue if needed
      if (type === 'fast' && this.endQueue.length > 0) {
        const transferredTasks = this.endQueue.splice(0)
        this.queues.fast.items.push(...transferredTasks)
        this.queues.fast.count += transferredTasks.length
        continue
      }

      // exit condition for queues
      const canExit = !queue.count && this.endFilling && (type !== 'fast' || this.queues.slow.isDone)

      if (canExit) {
        break
      }

      await setTimeout(100) // Reduced delay for faster checks
    }

    if (type === 'slow') queue.isDone = true
    this.logger.debug(`${capitalize(type)} queue ${id} is done`)
  }

  add(task: Task, size: number): void {
    const queue = size >= TRANSFER_MIN_SIZE ? this.queues.slow : this.queues.fast
    queue.items.push(task)
    queue.count++
  }

  addToEnd(task: Task, inFirst = false): void {
    if (inFirst) {
      this.endQueue.unshift(task)
    } else {
      this.endQueue.push(task)
    }
  }

  addToProps(task: Task): void {
    this.queues.props.items.push(task)
    this.queues.props.count++
  }

  fillingDone(): void {
    this.endFilling = true
  }

  stop(): void {
    this.stopped = true
  }
}
