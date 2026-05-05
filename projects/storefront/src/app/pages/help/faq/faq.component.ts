import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MetaService } from '../../../core/services/meta.service';

interface FaqItem {
  question: string;
  answer: string;
  open: boolean;
}

interface FaqSection {
  icon: string;
  title: string;
  items: FaqItem[];
}

@Component({
  selector: 'app-faq',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './faq.component.html',
  styleUrls: ['./faq.component.css']
})
export class FaqComponent implements OnInit {
  private metaService = inject(MetaService);

  sections: FaqSection[] = [
    {
      icon: '🚚',
      title: 'Envíos y Entregas',
      items: [
        {
          question: '¿Cuánto tiempo tarda el envío?',
          answer: 'Los envíos nacionales tardan <strong>1 a 3 días hábiles</strong> una vez confirmado el pago. En ciudades principales (CDMX, Guadalajara, Monterrey, SLP) generalmente llegan en 1–2 días. Zonas rurales o de difícil acceso pueden tomar hasta 5 días hábiles.',
          open: false
        },
        {
          question: '¿Tienen envío gratis?',
          answer: 'Sí. Ofrecemos <strong>envío gratis a todo México</strong> en pedidos superiores a $800 MXN. Para pedidos menores, el costo de envío se calcula automáticamente en el checkout según tu código postal.',
          open: false
        },
        {
          question: '¿A qué estados de la República hacen envíos?',
          answer: 'Enviamos a <strong>todos los estados de México</strong>, incluyendo zonas remotas. Trabajamos con las principales paqueterías: DHL, FedEx, Estafeta y J&T Express.',
          open: false
        },
        {
          question: '¿Cómo rastreo mi pedido?',
          answer: 'Una vez que tu pedido sea despachado, recibirás un número de guía por correo electrónico y/o WhatsApp. Puedes rastrear tu envío directamente en el sitio web de la paquetería asignada.',
          open: false
        },
        {
          question: '¿Qué pasa si no estoy en casa al momento de la entrega?',
          answer: 'La paquetería realizará hasta <strong>2 intentos de entrega</strong>. Si no hay nadie disponible, te dejarán un aviso con instrucciones para reagendar o recoger en sucursal. También puedes indicar una dirección alternativa al momento de tu compra.',
          open: false
        }
      ]
    },
    {
      icon: '💳',
      title: 'Pagos y Facturación',
      items: [
        {
          question: '¿Qué métodos de pago aceptan?',
          answer: 'Aceptamos: <strong>tarjetas de crédito y débito</strong> (Visa, Mastercard, American Express), <strong>transferencia bancaria (SPEI)</strong>, <strong>depósito en OXXO</strong>, y pagos a través de <strong>MercadoPago</strong>. Todos los pagos están protegidos con cifrado SSL.',
          open: false
        },
        {
          question: '¿Puedo pagar a meses sin intereses?',
          answer: 'Sí. Ofrecemos <strong>3, 6 y 12 meses sin intereses</strong> con tarjetas participantes a través de MercadoPago. El plan disponible depende del monto de tu compra y tu banco emisor.',
          open: false
        },
        {
          question: '¿Emiten factura?',
          answer: 'Sí. Para solicitar tu factura, envíanos tus datos fiscales (RFC, razón social, régimen fiscal y CFDI) al correo <strong>facturacion@importadoraeuro.com</strong> o por WhatsApp, indicando tu número de pedido. Emitimos facturas hasta <strong>5 días hábiles</strong> después de la compra.',
          open: false
        },
        {
          question: '¿Es seguro pagar en su tienda en línea?',
          answer: 'Sí. Nuestra tienda opera con certificado <strong>SSL/TLS</strong>, y no almacenamos datos de tarjetas en nuestros servidores. Todos los pagos con tarjeta se procesan a través de pasarelas certificadas PCI-DSS.',
          open: false
        }
      ]
    },
    {
      icon: '🔄',
      title: 'Devoluciones y Garantía',
      items: [
        {
          question: '¿Cuál es su política de devoluciones?',
          answer: 'Aceptamos devoluciones dentro de los <strong>30 días naturales</strong> posteriores a la recepción del producto, siempre que la llanta esté <strong>sin montar, sin usar y en su empaque original</strong>. Los productos instalados no son elegibles para devolución salvo defecto de fabricación.',
          open: false
        },
        {
          question: '¿Las llantas tienen garantía?',
          answer: 'Sí. Las llantas Praxis tienen <strong>garantía contra defectos de fabricación</strong> por el período que determine el fabricante (generalmente 2–5 años desde la fecha de producción, indicada en el código DOT). La garantía no cubre desgaste normal por uso, daños por impacto, pinchazos o instalación incorrecta.',
          open: false
        },
        {
          question: '¿Qué hago si recibo un producto dañado?',
          answer: 'Si tu pedido llega dañado, contáctanos dentro de las <strong>48 horas</strong> siguientes a la recepción. Envíanos fotos del daño y el embalaje a nuestro WhatsApp o correo. Gestionaremos el reemplazo o reembolso sin costo para ti.',
          open: false
        },
        {
          question: '¿Cuánto tarda un reembolso?',
          answer: 'Una vez aprobada la devolución, los reembolsos se procesan en <strong>3 a 7 días hábiles</strong>. El tiempo en que el dinero aparece en tu cuenta depende de tu banco o método de pago.',
          open: false
        }
      ]
    },
    {
      icon: '🏍️',
      title: 'Productos y Compatibilidad',
      items: [
        {
          question: '¿Cómo sé qué talla de llanta necesita mi moto?',
          answer: 'Hay tres formas: (1) leer el lateral de tu llanta actual, donde verás el código como <strong>120/70R17</strong>; (2) consultar el manual del propietario de tu moto; (3) escribirnos por WhatsApp con el modelo y año de tu moto — te indicamos la talla exacta sin costo. También puedes leer nuestra <a href="/blog/guia-tallas-llanta-moto">guía completa de tallas</a>.',
          open: false
        },
        {
          question: '¿Qué diferencia hay entre la Praxis Raptor y la Urban?',
          answer: 'La <strong>Praxis Raptor</strong> es una llanta de alto rendimiento con perfil deportivo, ideal para carretera y motos de media/alta cilindrada. La <strong>Praxis Urban</strong> está optimizada para uso diario en ciudad: mayor durabilidad (hasta 25,000 km) y menor costo por kilómetro. Lee nuestra <a href="/blog/praxis-raptor-vs-urban">comparativa completa Raptor vs Urban</a>.',
          open: false
        },
        {
          question: '¿Tienen llantas para Italika?',
          answer: 'Sí. Manejamos llantas Praxis compatibles con los modelos Italika más populares: FT150, DM200, WS150, CS150, GS200 y más. Consulta nuestra <a href="/blog/llantas-praxis-para-italika">guía de llantas para Italika</a> con tabla de tallas por modelo.',
          open: false
        },
        {
          question: '¿Venden llantas delanteras y traseras por separado?',
          answer: 'Sí. Puedes comprar cada llanta individualmente o en kit (delantera + trasera). Los kits suelen tener un precio preferencial. Filtra por categoría en nuestro <a href="/catalogo">catálogo</a>.',
          open: false
        },
        {
          question: '¿Qué marcas venden?',
          answer: 'Actualmente somos distribuidores autorizados de <strong>Praxis</strong>, marca líder en llantas para motocicleta con presencia en más de 40 países. Próximamente ampliaremos nuestro catálogo con otras marcas.',
          open: false
        }
      ]
    },
    {
      icon: '📞',
      title: 'Contacto y Soporte',
      items: [
        {
          question: '¿Cómo puedo contactarlos?',
          answer: '<strong>WhatsApp:</strong> <a href="https://wa.me/524441946502" target="_blank" rel="noopener">+52 444 194 6502</a> (lunes a viernes 9am–6pm, sábados 9am–2pm). <strong>Correo:</strong> contacto@importadoraeuro.com. Respondemos en menos de 2 horas en horario hábil.',
          open: false
        },
        {
          question: '¿Tienen tienda física?',
          answer: 'Nuestro centro de operaciones está en <strong>San Luis Potosí, S.L.P.</strong>. Las ventas y envíos son principalmente en línea. Si necesitas visitar nuestras instalaciones, escríbenos primero para coordinar una cita.',
          open: false
        },
        {
          question: '¿Cuál es su horario de atención?',
          answer: '<strong>Lunes a Viernes:</strong> 9:00 am – 6:00 pm (CST). <strong>Sábados:</strong> 9:00 am – 2:00 pm. <strong>Domingos y días festivos:</strong> cerrado. Los pedidos recibidos fuera de horario se procesan el siguiente día hábil.',
          open: false
        }
      ]
    }
  ];

  toggleItem(section: FaqSection, item: FaqItem): void {
    item.open = !item.open;
  }

  ngOnInit(): void {
    this.metaService.updateTags({
      title: 'Preguntas Frecuentes — Importadora Eurollantas',
      description: 'Resuelve tus dudas sobre envíos, pagos, devoluciones, garantías y compatibilidad de llantas Praxis. Encuentra respuesta a las preguntas más frecuentes de nuestros clientes.',
      image: 'assets/images/euro-logo-new.png'
    });

    // Inject FAQPage schema
    this.metaService.addStructuredData({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      'name': 'Preguntas Frecuentes — Importadora Eurollantas',
      'mainEntity': this.sections.flatMap(s => s.items.map(item => ({
        '@type': 'Question',
        'name': item.question,
        'acceptedAnswer': {
          '@type': 'Answer',
          'text': item.answer.replace(/<[^>]+>/g, '') // strip HTML for schema
        }
      })))
    });
  }
}
