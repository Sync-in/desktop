import { describe, expect, it, vi } from 'vitest'
import { Report } from './report'

describe('Report lifecycle', () => {
  it('stops transfers when DiffParser.run fails', async () => {
    const failure = new Error('diff failed')
    const stop = vi.fn()
    const report = Object.create(Report.prototype) as Report
    Object.assign(report, {
      diff: {
        run: () => ({
          [Symbol.asyncIterator]: () => ({
            next: async () => {
              throw failure
            }
          })
        })
      },
      transfers: { stop }
    })

    await expect(report.run()).rejects.toBe(failure)

    expect(stop).toHaveBeenCalledOnce()
  })
})
