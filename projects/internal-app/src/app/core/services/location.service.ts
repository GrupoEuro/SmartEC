import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of } from 'rxjs';

export interface ZipCodeResponse {
    country: string;
    'country abbreviation': string;
    'post code': string;
    places: {
        'place name': string;
        longitude: string;
        state: string;
        'state abbreviation': string;
        latitude: string;
    }[];
}

@Injectable({
    providedIn: 'root'
})
export class LocationService {
    private http = inject(HttpClient);

    getZipCodeInfo(zipCode: string): Observable<ZipCodeResponse | null> {
        return this.http.get<ZipCodeResponse>(`https://api.zippopotam.us/mx/${zipCode}`).pipe(
            catchError(() => of(null))
        );
    }
}
