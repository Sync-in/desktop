import { Pipe, PipeTransform } from '@angular/core'
import { dJs } from '../functions/time'

@Pipe({ name: 'amDuration', pure: false, standalone: true })
export class TimeDurationPipe implements PipeTransform {
  transform(value: any, unit: string): string {
    if (!unit) {
      throw new Error('TimeDurationPipe: missing required time unit argument')
    }
    return dJs.duration({ [unit]: value }).humanize()
  }
}
