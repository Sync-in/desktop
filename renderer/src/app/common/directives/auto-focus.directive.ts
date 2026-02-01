import { Directive, ElementRef, inject, Input, OnInit } from '@angular/core'

@Directive({ selector: '[appAutofocus]' })
export class AutofocusDirective implements OnInit {
  private readonly elementRef = inject(ElementRef)
  @Input() autoFocus = true
  @Input() autoSelect = true

  ngOnInit() {
    setTimeout(() => {
      if (this.autoFocus) {
        this.elementRef.nativeElement.focus()
      }
      if (this.autoSelect) {
        this.elementRef.nativeElement.select()
      }
    }, 0)
  }
}
