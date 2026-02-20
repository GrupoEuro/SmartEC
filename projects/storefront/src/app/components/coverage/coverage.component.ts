import { Component, OnInit, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { GoogleMapsModule } from '@angular/google-maps';

@Component({
  selector: 'app-coverage',
  standalone: true,
  imports: [CommonModule, TranslateModule, GoogleMapsModule],
  templateUrl: './coverage.component.html',
  styleUrl: './coverage.component.css'
})
export class CoverageComponent implements OnInit {
  isBrowser = false;
  mapReady = false;

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }
  // Center of Las Gaviotas, SLP
  center: google.maps.LatLngLiteral = { lat: 22.1392, lng: -100.9572 };
  zoom = 12; // Zoomed out to see the city

  // San Luis Potosí Hub
  markerOptions: google.maps.MarkerOptions = {
    draggable: false
  };
  markerPositions: google.maps.LatLngLiteral[] = [
    { lat: 22.1392, lng: -100.9572 } // Salvador Nava Martinez 704
  ];

  mapOptions: google.maps.MapOptions = {
    mapId: 'DEMO_MAP_ID', // Use a real Map ID for advanced markers if needed
    disableDefaultUI: false,
    scrollwheel: false,
    zoomControl: true,
    styles: [
      {
        "elementType": "geometry",
        "stylers": [{ "color": "#242f3e" }]
      },
      {
        "elementType": "labels.text.stroke",
        "stylers": [{ "color": "#242f3e" }]
      },
      {
        "elementType": "labels.text.fill",
        "stylers": [{ "color": "#746855" }]
      },
      {
        "featureType": "administrative.locality",
        "elementType": "labels.text.fill",
        "stylers": [{ "color": "#d59563" }]
      },
      // ... more styles can be added for the dark theme look
    ]
  };

  ngOnInit(): void {
    if (this.isBrowser) {
      this.loadGoogleMapsScript().then(() => {
        this.mapReady = true;
        if (typeof google !== 'undefined') {
          this.markerOptions = {
            ...this.markerOptions,
            animation: google.maps.Animation.DROP,
          };
        }
      });
    }
  }

  private loadGoogleMapsScript(): Promise<void> {
    return new Promise((resolve) => {
      if (typeof google !== 'undefined' && google.maps) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://maps.googleapis.com/maps/api/js?key=AIzaSyCXekYyZCDzs6p0tIrSR_sc-r2ywsbEm0o&loading=async';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        console.error('Failed to load Google Maps SDK');
        resolve();
      };
      document.head.appendChild(script);
    });
  }
}
