import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { FormsModule } from '@angular/forms';
import { Firestore, collection, addDoc } from '@angular/fire/firestore';
import { inject } from '@angular/core';

@Component({
  selector: 'app-distributor-form',
  standalone: true,
  imports: [CommonModule, TranslateModule, FormsModule],
  templateUrl: './distributor-form.component.html',
  styleUrl: './distributor-form.component.css'
})
export class DistributorFormComponent {
  distributor = {
    name: '',
    business: '',
    email: '',
    phone: '',
    state: '',
    volume: '',
    comments: ''
  };

  isSubmitting = false;
  submitSuccess = false;
  submitError = false;

  private firestore: Firestore = inject(Firestore);

  states = [
    { value: 'AGU', label: 'Aguascalientes' },
    { value: 'BCN', label: 'Baja California' },
    { value: 'BCS', label: 'Baja California Sur' },
    { value: 'CAM', label: 'Campeche' },
    { value: 'CHP', label: 'Chiapas' },
    { value: 'CHH', label: 'Chihuahua' },
    { value: 'CMX', label: 'Ciudad de México' },
    { value: 'COA', label: 'Coahuila' },
    { value: 'COL', label: 'Colima' },
    { value: 'DUR', label: 'Durango' },
    { value: 'GUA', label: 'Guanajuato' },
    { value: 'GRO', label: 'Guerrero' },
    { value: 'HID', label: 'Hidalgo' },
    { value: 'JAL', label: 'Jalisco' },
    { value: 'MEX', label: 'Estado de México' },
    { value: 'MIC', label: 'Michoacán' },
    { value: 'MOR', label: 'Morelos' },
    { value: 'NAY', label: 'Nayarit' },
    { value: 'NLE', label: 'Nuevo León' },
    { value: 'OAX', label: 'Oaxaca' },
    { value: 'PUE', label: 'Puebla' },
    { value: 'QUE', label: 'Querétaro' },
    { value: 'ROO', label: 'Quintana Roo' },
    { value: 'SLP', label: 'San Luis Potosí' },
    { value: 'SIN', label: 'Sinaloa' },
    { value: 'SON', label: 'Sonora' },
    { value: 'TAB', label: 'Tabasco' },
    { value: 'TAM', label: 'Tamaulipas' },
    { value: 'TLA', label: 'Tlaxcala' },
    { value: 'VER', label: 'Veracruz' },
    { value: 'YUC', label: 'Yucatán' },
    { value: 'ZAC', label: 'Zacatecas' }
  ];

  honeypot = ''; // Hidden field for bot protection

  async onSubmit(form: any) {
    console.log('Submit triggered', this.distributor);

    // 1. Bot Protection (Honeypot)
    if (this.honeypot) {
      console.warn('Bot detected: Honeypot filled');
      return; // Silent failure for bots
    }

    // 2. Validation
    if (form && form.invalid) {
      console.warn('Form is invalid', form.errors);
      alert('Por favor completa todos los campos requeridos (Nombre, Empresa, Email, Teléfono, Estado).');
      return;
    }

    // Strict format checks
    const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    const phonePattern = /^[0-9]{10}$/;

    if (!emailPattern.test(this.distributor.email)) {
      alert('Por favor ingresa un correo electrónico válido.');
      return;
    }

    if (!phonePattern.test(this.distributor.phone.replace(/\D/g, ''))) {
      alert('Por favor ingresa un número de teléfono válido (10 dígitos).');
      return;
    }

    this.isSubmitting = true;
    this.submitSuccess = false;
    this.submitError = false;

    try {
      console.log('Attempting to add document to Firestore...');
      const docRef = await addDoc(collection(this.firestore, 'distributors'), {
        ...this.distributor,
        createdAt: new Date()
      });
      console.log('Document written with ID: ', docRef.id);

      this.submitSuccess = true;
      if (form) form.resetForm();
      this.distributor = {
        name: '',
        business: '',
        email: '',
        phone: '',
        state: '',
        volume: '',
        comments: ''
      };
    } catch (e) {
      console.error('Error adding document: ', e);
      this.submitError = true;
      alert(`Error tecnico: ${e} `);
    } finally {
      this.isSubmitting = false;
    }
  }
}
