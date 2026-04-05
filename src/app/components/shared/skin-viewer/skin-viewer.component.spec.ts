import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { SkinViewerComponent } from './skin-viewer.component';
import { SkinService } from '../../../services/skin/skin.service';

class MockSkinService {
  async getBlobUrl(url: string): Promise<string> {
    return url;
  }
}

describe('SkinViewerComponent', () => {
  let fixture: ComponentFixture<SkinViewerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SkinViewerComponent],
      providers: [
        { provide: SkinService, useClass: MockSkinService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SkinViewerComponent);
  });

  it('renders 3D container when isRaw is true', () => {
    fixture.componentRef.setInput('skinUrl', '');
    fixture.componentRef.setInput('isRaw', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.skin-canvas')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('img.skin-image')).toBeFalsy();
  });

  it('renders fallback image when isRaw is false', () => {
    fixture.componentRef.setInput('skinUrl', 'https://mc-heads.net/body/Steve/200');
    fixture.componentRef.setInput('isRaw', false);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.skin-canvas')).toBeFalsy();
    expect(fixture.nativeElement.querySelector('img.skin-image')).toBeTruthy();
  });
});



