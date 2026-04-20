import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormArray, FormGroup, Validators } from '@angular/forms';
import { Firestore, doc, getDoc, setDoc } from '@angular/fire/firestore';
import { ToastService } from '../../../../core/services/toast.service';
import { AppIconComponent } from '../../../../shared/components/app-icon/app-icon.component';

export interface FaqItem {
    question: string;
    answer:   string;
    active:   boolean;
}

export interface SeoConfig {
    faq:         FaqItem[];
    orgName:     string;
    orgDesc:     string;
    phone:       string;
    whatsapp:    string;
    address:     string;
    city:        string;
    facebook:    string;
    instagram:   string;
    priceRange:  string;
    hoursWeekday: string;   // e.g. "09:00-19:00"
    hoursSaturday: string;
}

const SEO_DOC = 'config/seo';

@Component({
    selector: 'app-admin-seo',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, AppIconComponent],
    templateUrl: './admin-seo.component.html',
    styleUrls: ['./admin-seo.component.css'],
})
export class AdminSeoComponent implements OnInit {
    private fb      = inject(FormBuilder);
    private fs      = inject(Firestore);
    private toast   = inject(ToastService);

    isLoading = signal(true);
    isSaving  = signal(false);

    form = this.fb.group({
        orgName:       ['Importadora Eurollantas'],
        orgDesc:       ['Distribuidor autorizado de llantas para motocicleta Michelin y Praxis en México. Compra en línea con envío a toda la República. Amplio catálogo en medidas para motos deportivas, naked, touring, doble propósito y scooter.'],
        phone:         ['+52 444 824 0757'],
        whatsapp:      ['+52 444 194 6502'],
        address:       ['San Luis Potosí'],
        city:          ['San Luis Potosí'],
        facebook:      ['https://facebook.com/eurollantas'],
        instagram:     ['https://instagram.com/eurollantas'],
        priceRange:    ['$$'],
        hoursWeekday:  ['09:00-19:00'],
        hoursSaturday: ['09:00-14:00'],
        faq: this.fb.array([]),
    });

    get faqArray(): FormArray { return this.form.get('faq') as FormArray; }

    ngOnInit() { this.load(); }

    private async load() {
        this.isLoading.set(true);
        try {
            const snap = await getDoc(doc(this.fs, SEO_DOC));
            if (snap.exists()) {
                const data = snap.data() as SeoConfig;
                this.form.patchValue({
                    orgName:       data.orgName       ?? '',
                    orgDesc:       data.orgDesc        ?? '',
                    phone:         data.phone          ?? '',
                    whatsapp:      data.whatsapp       ?? '',
                    address:       data.address        ?? '',
                    city:          data.city            ?? '',
                    facebook:      data.facebook       ?? '',
                    instagram:     data.instagram      ?? '',
                    priceRange:    data.priceRange     ?? '$$',
                    hoursWeekday:  data.hoursWeekday   ?? '09:00-19:00',
                    hoursSaturday: data.hoursSaturday  ?? '09:00-14:00',
                });
                // Populate FAQ FormArray
                (data.faq || []).forEach(item => this.faqArray.push(this.makeFaqGroup(item)));
            }
            if (this.faqArray.length === 0) this.addDefaultFaqs();
        } catch (e) {
            console.warn('[AdminSeo] Load error:', e);
            this.addDefaultFaqs();
        } finally {
            this.isLoading.set(false);
        }
    }

    private makeFaqGroup(item: Partial<FaqItem> = {}): FormGroup {
        return this.fb.group({
            question: [item.question ?? '', Validators.required],
            answer:   [item.answer   ?? '', Validators.required],
            active:   [item.active   ?? true],
        });
    }

    addFaq() {
        this.faqArray.push(this.makeFaqGroup());
    }

    removeFaq(i: number) {
        this.faqArray.removeAt(i);
    }

    moveFaq(i: number, dir: -1 | 1) {
        const j = i + dir;
        if (j < 0 || j >= this.faqArray.length) return;
        const a = this.faqArray.at(i).value;
        const b = this.faqArray.at(j).value;
        this.faqArray.at(i).patchValue(b);
        this.faqArray.at(j).patchValue(a);
    }

    async save() {
        if (this.form.invalid) return;
        this.isSaving.set(true);
        try {
            const val = this.form.value as SeoConfig;
            await setDoc(doc(this.fs, SEO_DOC), val, { merge: true });

            // Also regenerate the JSON-LD preview object (optional — logged for reference)
            console.log('[AdminSeo] Preview JSON-LD:', this.buildFaqSchema(val.faq || []));

            this.toast.success('✅ Configuración SEO guardada. Los cambios se verán en el sitio en segundos.');
        } catch (e) {
            console.error(e);
            this.toast.error('Error al guardar. Intenta de nuevo.');
        } finally {
            this.isSaving.set(false);
        }
    }

    private buildFaqSchema(faq: FaqItem[]): object {
        return {
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: faq
                .filter(f => f.active && f.question && f.answer)
                .map(f => ({
                    '@type': 'Question',
                    name: f.question,
                    acceptedAnswer: { '@type': 'Answer', text: f.answer }
                }))
        };
    }

    previewSchema() {
        const val = this.form.value as SeoConfig;
        const schema = this.buildFaqSchema(val.faq || []);
        const win = window.open('', '_blank');
        if (win) {
            win.document.write(`<pre style="font-family:monospace;padding:20px;background:#111;color:#d4d4d8;white-space:pre-wrap">${JSON.stringify(schema, null, 2)}</pre>`);
            win.document.close();
        }
    }

    private addDefaultFaqs() {
        const defaults: FaqItem[] = [
            {
                question: '¿Cómo sé qué medida de llanta necesita mi moto?',
                answer: 'La medida viene impresa en el lateral de la llanta actual en un formato como 120/70R17 o 140/70-17. El primer número es el ancho en mm, el segundo es el perfil en porcentaje y el tercero es el diámetro del rin en pulgadas. También puedes consultarla en el manual de tu motocicleta o en la placa de especificaciones del fabricante. En Importadora Euro te ayudamos a identificar la medida correcta para tu moto.',
                active: true
            },
            {
                question: '¿Hacen envíos de llantas para moto a todo México?',
                answer: 'Sí, realizamos envíos a toda la República Mexicana. Los pedidos realizados antes de las 2:00 pm salen el mismo día hábil. El tiempo de entrega es de 1 a 3 días hábiles según tu ubicación. Manejamos paquetería con rastreo en línea para que puedas seguir tu pedido en todo momento.',
                active: true
            },
            {
                question: '¿Son llantas Michelin originales y con garantía?',
                answer: 'Sí. Somos distribuidores autorizados de Michelin y Praxis en México. Todas nuestras llantas son 100% originales, nuevas y cuentan con la garantía oficial del fabricante contra defectos de manufactura. Nunca vendemos producto de segunda mano ni reencauchadas.',
                active: true
            },
            {
                question: '¿Cada cuántos kilómetros se deben cambiar las llantas de la moto?',
                answer: 'En condiciones normales de rodaje, las llantas delanteras duran entre 10,000 y 15,000 km, y las traseras entre 8,000 y 12,000 km, dependiendo de la marca, el tipo de uso y el estilo de manejo. Te recomendamos revisar la banda de rodadura mensualmente y cambiarlas cuando el indicador de desgaste quede al ras con la superficie del neumático.',
                active: true
            },
            {
                question: '¿Qué tipos de motos y medidas de llantas manejan?',
                answer: 'Contamos con llantas para motos deportivas, naked, touring, trail, doble propósito, scooter y motonetas. Manejamos las principales medidas del mercado mexicano: 90/90-21, 100/90-19, 110/70-17, 120/70R17, 130/70R17, 140/70R17, 150/70R17, 160/60R17, entre otras. Si no encuentras tu medida en el catálogo, contáctanos por WhatsApp y te ayudamos.',
                active: true
            },
            {
                question: '¿Cuál es la diferencia entre llanta radial y diagonal para moto?',
                answer: 'Las llantas radiales (marcadas con R, ej: 120/70R17) tienen las capas de cuerda en ángulo de 90° respecto al sentido de la marcha. Ofrecen mayor estabilidad a alta velocidad, mejor maniobrabilidad y menor calentamiento. Las diagonales o convencionales (sin R, ej: 120/70-17) son más rígidas y resistentes a cargas pesadas, ideales para motos de trabajo, scooters y doble propósito de bajo presupuesto. Michelin y Praxis fabrican ambos tipos.',
                active: true
            },
            {
                question: '¿Puedo comprar solo una llanta, la delantera o la trasera?',
                answer: 'Sí, puedes comprar las llantas por separado. Sin embargo, los fabricantes recomiendan cambiar ambas al mismo tiempo para mantener el equilibrio y el comportamiento del neumático en curvas y frenadas. Si cambias solo una, asegúrate de que ambas sean de la misma marca y tipo de construcción.',
                active: true
            },
            {
                question: '¿Aceptan devoluciones o cambios de llantas?',
                answer: 'Aceptamos devoluciones en los primeros 7 días naturales si el producto presenta defectos de fabricante o si se entregó una medida incorrecta por error nuestro. Las llantas ya montadas en el rin no pueden devolverse. Para iniciar un cambio o devolución contáctanos por WhatsApp con tu número de pedido.',
                active: true
            },
        ];
        defaults.forEach(d => this.faqArray.push(this.makeFaqGroup(d)));
    }
}
