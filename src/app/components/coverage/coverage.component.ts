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

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }
  // Center of Mexico
  center: google.maps.LatLngLiteral = { lat: 23.6345, lng: -102.5528 };
  zoom = 5;

  // San Luis Potosí Hub
  markerOptions: google.maps.MarkerOptions = {
    draggable: false
  };
  markerPositions: google.maps.LatLngLiteral[] = [
    { lat: 22.1566, lng: -100.9855 } // SLP
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
    if (this.isBrowser && typeof google !== 'undefined') {
      this.markerOptions = {
        ...this.markerOptions,
        animation: google.maps.Animation.DROP,
      };
    }
  }
}

