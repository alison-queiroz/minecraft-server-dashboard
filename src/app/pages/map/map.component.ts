import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Location } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { MapViewerComponent } from '../../components/shared/map-viewer/map-viewer.component';
import { LucideMap, LucideArrowLeft } from '@lucide/angular';
import { IconComponent } from '../../components/shared/icon/icon.component';

@Component({
  selector: 'app-map',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MapViewerComponent, IconComponent],
  templateUrl: './map.component.html',
  styleUrls: ['./map.component.scss'],
})
export class MapComponent {
  protected readonly LucideMap       = LucideMap;
  protected readonly LucideArrowLeft = LucideArrowLeft;

  private readonly route = inject(ActivatedRoute);
  protected readonly location = inject(Location);

  /** Fragment from the URL (#mapId:x:z:zoom) — set synchronously so the iframe
   * loads with the correct position on first render (avoids same-doc hash nav). */
  protected readonly navigateToHash = toSignal(
    this.route.fragment.pipe(map(f => f ?? '')),
    { initialValue: this.route.snapshot.fragment ?? '' }
  );
}
