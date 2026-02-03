import { AxiosRequestConfig } from 'axios'
import { ReadStream } from 'node:fs'

export interface AxiosExtendedRequestConfig extends AxiosRequestConfig {
  getData?: () => ReadStream
}
