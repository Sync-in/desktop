export type ApplicationCounter = 'notifications' | 'tasks' | 'syncs'

export interface ServerAppCounter {
  id: number
  name: string
  applications: Record<ApplicationCounter, number>
}
