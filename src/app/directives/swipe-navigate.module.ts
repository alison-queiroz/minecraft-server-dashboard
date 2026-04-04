import { NgModule } from '@angular/core';
import { SwipeNavigateDirective } from './swipe-navigate.directive';

@NgModule({
  imports: [SwipeNavigateDirective],
  exports: [SwipeNavigateDirective],
})
export class SwipeNavigateModule {}
