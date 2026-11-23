import { AxiosRequestConfig } from 'axios'
import type { Readable } from 'node:stream'

export interface AxiosExtendedRequestConfig extends AxiosRequestConfig {
  getData?: () => Readable | Buffer
  skipConnectionRetry?: boolean
}
