import { Injectable } from '@angular/core';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Order } from '../models/order.model';

interface CompanyInfo {
    name: string;
    address: string;
    city: string;
    phone: string;
    email: string;
    rfc?: string;
}

@Injectable({
    providedIn: 'root'
})
export class PdfGenerationService {

    private companyInfo: CompanyInfo = {
        name: 'Importadora Euro',
        address: 'Av. Salvador Nava No.704-1, Col. Nuevo Paseo',
        city: 'San Luis Potosí, S.L.P',
        phone: 'Tel: (444) 123-4567',
        email: 'contacto@importadoraeuro.com',
        rfc: 'IEU123456789'
    };

    constructor() { }

    /**
     * Generate a packing slip PDF for an order
     */
    generatePackingSlip(order: Order): jsPDF {
        const doc = new jsPDF();
        const pageWidth = doc.internal.pageSize.getWidth();
        let yPos = 20;

        // Header
        doc.setFontSize(20);
        doc.setFont('helvetica', 'bold');
        doc.text('PACKING SLIP', pageWidth / 2, yPos, { align: 'center' });
        yPos += 10;

        // Company Info
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text(this.companyInfo.name, 20, yPos);
        yPos += 5;
        doc.text(this.companyInfo.address, 20, yPos);
        yPos += 5;
        doc.text(this.companyInfo.city, 20, yPos);
        yPos += 5;
        doc.text(this.companyInfo.phone, 20, yPos);
        yPos += 10;

        // Order Info
        doc.setFont('helvetica', 'bold');
        doc.text(`Order Number: ${order.orderNumber}`, 20, yPos);
        yPos += 5;
        doc.setFont('helvetica', 'normal');
        const orderDate = this.formatDate(order.createdAt);
        doc.text(`Order Date: ${orderDate}`, 20, yPos);
        yPos += 10;

        // Shipping Address
        doc.setFont('helvetica', 'bold');
        doc.text('SHIP TO:', 20, yPos);
        yPos += 5;
        doc.setFont('helvetica', 'normal');
        doc.text(order.customer.name, 20, yPos);
        yPos += 5;
        const addr = order.shippingAddress;
        doc.text(`${addr.street} ${addr.exteriorNumber}${addr.interiorNumber ? ' Int. ' + addr.interiorNumber : ''}`, 20, yPos);
        yPos += 5;
        if (addr.colonia) {
            doc.text(`Col. ${addr.colonia}`, 20, yPos);
            yPos += 5;
        }
        doc.text(`${addr.city}, ${addr.state} ${addr.zipCode}`, 20, yPos);
        yPos += 5;
        doc.text(order.customer.phone, 20, yPos);
        yPos += 10;

        // Items Table
        const tableData = order.items.map(item => [
            '☐', // Checkbox
            item.sku,
            item.productName,
            item.quantity.toString(),
            '' // Notes column
        ]);

        autoTable(doc, {
            startY: yPos,
            head: [['✓', 'SKU', 'Product', 'Qty', 'Notes']],
            body: tableData,
            theme: 'grid',
            headStyles: {
                fillColor: [41, 128, 185],
                textColor: 255,
                fontStyle: 'bold'
            },
            columnStyles: {
                0: { cellWidth: 10 }, // Checkbox
                1: { cellWidth: 30 }, // SKU
                2: { cellWidth: 80 }, // Product
                3: { cellWidth: 20 }, // Qty
                4: { cellWidth: 50 }  // Notes
            },
            margin: { left: 20, right: 20 }
        });

        // Get final Y position after table
        const finalY = (doc as any).lastAutoTable.finalY || yPos + 50;

        // Special Instructions
        if (order.notes) {
            doc.setFont('helvetica', 'bold');
            doc.text('Special Instructions:', 20, finalY + 10);
            doc.setFont('helvetica', 'normal');
            doc.text(order.notes, 20, finalY + 15, { maxWidth: pageWidth - 40 });
        }

        // Footer
        const footerY = doc.internal.pageSize.getHeight() - 20;
        doc.setFontSize(8);
        doc.setFont('helvetica', 'italic');
        doc.text('Thank you for your business!', pageWidth / 2, footerY, { align: 'center' });

        return doc;
    }

    /**
     * Generate an invoice PDF for an order
     */
    generateInvoice(order: Order): jsPDF {
        const doc = new jsPDF();
        const pageWidth = doc.internal.pageSize.getWidth();
        let yPos = 20;

        // Header
        doc.setFontSize(20);
        doc.setFont('helvetica', 'bold');
        doc.text('INVOICE', pageWidth / 2, yPos, { align: 'center' });
        yPos += 10;

        // Company Info (Left)
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text(this.companyInfo.name, 20, yPos);
        yPos += 5;
        doc.setFont('helvetica', 'normal');
        doc.text(this.companyInfo.address, 20, yPos);
        yPos += 5;
        doc.text(this.companyInfo.city, 20, yPos);
        yPos += 5;
        doc.text(this.companyInfo.phone, 20, yPos);
        yPos += 5;
        doc.text(this.companyInfo.email, 20, yPos);
        yPos += 5;
        if (this.companyInfo.rfc) {
            doc.text(`RFC: ${this.companyInfo.rfc}`, 20, yPos);
        }

        // Invoice Info (Right)
        const rightX = pageWidth - 20;
        let rightY = 30;
        doc.setFont('helvetica', 'bold');
        doc.text(`Invoice #: ${order.orderNumber}`, rightX, rightY, { align: 'right' });
        rightY += 5;
        doc.setFont('helvetica', 'normal');
        doc.text(`Date: ${this.formatDate(order.createdAt)}`, rightX, rightY, { align: 'right' });
        rightY += 5;
        doc.text(`Payment: ${this.formatPaymentMethod(order.paymentMethod)}`, rightX, rightY, { align: 'right' });

        yPos += 10;

        // Bill To
        doc.setFont('helvetica', 'bold');
        doc.text('BILL TO:', 20, yPos);
        yPos += 5;
        doc.setFont('helvetica', 'normal');
        doc.text(order.customer.name, 20, yPos);
        yPos += 5;
        doc.text(order.customer.email, 20, yPos);
        yPos += 5;
        doc.text(order.customer.phone, 20, yPos);
        yPos += 5;
        if (order.customer.rfc) {
            doc.text(`RFC: ${order.customer.rfc}`, 20, yPos);
            yPos += 5;
        }
        yPos += 10;

        // Items Table
        const tableData = order.items.map(item => [
            item.sku,
            item.productName,
            item.quantity.toString(),
            this.formatCurrency(item.price),
            this.formatCurrency(item.subtotal)
        ]);

        autoTable(doc, {
            startY: yPos,
            head: [['SKU', 'Product', 'Qty', 'Price', 'Subtotal']],
            body: tableData,
            theme: 'striped',
            headStyles: {
                fillColor: [41, 128, 185],
                textColor: 255,
                fontStyle: 'bold'
            },
            columnStyles: {
                0: { cellWidth: 30 },  // SKU
                1: { cellWidth: 80 },  // Product
                2: { cellWidth: 20, halign: 'center' }, // Qty
                3: { cellWidth: 30, halign: 'right' },  // Price
                4: { cellWidth: 30, halign: 'right' }   // Subtotal
            },
            margin: { left: 20, right: 20 }
        });

        // Get final Y position after table
        const finalY = (doc as any).lastAutoTable.finalY || yPos + 50;

        // Totals
        const totalsX = pageWidth - 20;
        let totalsY = finalY + 10;

        doc.setFont('helvetica', 'normal');
        doc.text('Subtotal:', totalsX - 50, totalsY);
        doc.text(this.formatCurrency(order.subtotal), totalsX, totalsY, { align: 'right' });
        totalsY += 5;

        if (order.discount > 0) {
            doc.text('Discount:', totalsX - 50, totalsY);
            doc.text(`-${this.formatCurrency(order.discount)}`, totalsX, totalsY, { align: 'right' });
            totalsY += 5;
        }

        doc.text('Shipping:', totalsX - 50, totalsY);
        doc.text(this.formatCurrency(order.shippingCost), totalsX, totalsY, { align: 'right' });
        totalsY += 5;

        doc.text('Tax (IVA):', totalsX - 50, totalsY);
        doc.text(this.formatCurrency(order.tax), totalsX, totalsY, { align: 'right' });
        totalsY += 7;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.text('TOTAL:', totalsX - 50, totalsY);
        doc.text(this.formatCurrency(order.total), totalsX, totalsY, { align: 'right' });

        // Footer
        const footerY = doc.internal.pageSize.getHeight() - 20;
        doc.setFontSize(8);
        doc.setFont('helvetica', 'italic');
        doc.text('Thank you for your business!', pageWidth / 2, footerY, { align: 'center' });
        doc.setFontSize(7);
        doc.text('This is a computer-generated invoice and does not require a signature.', pageWidth / 2, footerY + 4, { align: 'center' });

        return doc;
    }

    /**
     * Generate bulk packing slips for multiple orders
     */
    generateBulkPackingSlips(orders: Order[]): jsPDF {
        const doc = new jsPDF();

        orders.forEach((order, index) => {
            if (index > 0) {
                doc.addPage();
            }

            // Generate packing slip content for this order
            const tempDoc = this.generatePackingSlip(order);

            // Copy content from temp doc to main doc
            // Note: This is a simplified approach. For production, you might want to
            // refactor to have a shared rendering method that takes a doc parameter
            const pageWidth = doc.internal.pageSize.getWidth();
            let yPos = 20;

            // Header
            doc.setFontSize(20);
            doc.setFont('helvetica', 'bold');
            doc.text('PACKING SLIP', pageWidth / 2, yPos, { align: 'center' });
            yPos += 10;

            // Company Info
            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            doc.text(this.companyInfo.name, 20, yPos);
            yPos += 5;
            doc.text(this.companyInfo.address, 20, yPos);
            yPos += 5;
            doc.text(this.companyInfo.city, 20, yPos);
            yPos += 5;
            doc.text(this.companyInfo.phone, 20, yPos);
            yPos += 10;

            // Order Info
            doc.setFont('helvetica', 'bold');
            doc.text(`Order Number: ${order.orderNumber}`, 20, yPos);
            yPos += 5;
            doc.setFont('helvetica', 'normal');
            const orderDate = this.formatDate(order.createdAt);
            doc.text(`Order Date: ${orderDate}`, 20, yPos);
            yPos += 10;

            // Shipping Address
            doc.setFont('helvetica', 'bold');
            doc.text('SHIP TO:', 20, yPos);
            yPos += 5;
            doc.setFont('helvetica', 'normal');
            doc.text(order.customer.name, 20, yPos);
            yPos += 5;
            const addr = order.shippingAddress;
            doc.text(`${addr.street} ${addr.exteriorNumber}${addr.interiorNumber ? ' Int. ' + addr.interiorNumber : ''}`, 20, yPos);
            yPos += 5;
            if (addr.colonia) {
                doc.text(`Col. ${addr.colonia}`, 20, yPos);
                yPos += 5;
            }
            doc.text(`${addr.city}, ${addr.state} ${addr.zipCode}`, 20, yPos);
            yPos += 5;
            doc.text(order.customer.phone, 20, yPos);
            yPos += 10;

            // Items Table
            const tableData = order.items.map(item => [
                '☐',
                item.sku,
                item.productName,
                item.quantity.toString(),
                ''
            ]);

            autoTable(doc, {
                startY: yPos,
                head: [['✓', 'SKU', 'Product', 'Qty', 'Notes']],
                body: tableData,
                theme: 'grid',
                headStyles: {
                    fillColor: [41, 128, 185],
                    textColor: 255,
                    fontStyle: 'bold'
                },
                columnStyles: {
                    0: { cellWidth: 10 },
                    1: { cellWidth: 30 },
                    2: { cellWidth: 80 },
                    3: { cellWidth: 20 },
                    4: { cellWidth: 50 }
                },
                margin: { left: 20, right: 20 }
            });
        });

        return doc;
    }

    /**
     * Print a PDF document
     */
    printPdf(doc: jsPDF): void {
        // Open in new window and trigger print dialog
        const pdfBlob = doc.output('blob');
        const pdfUrl = URL.createObjectURL(pdfBlob);
        const printWindow = window.open(pdfUrl, '_blank');

        if (printWindow) {
            printWindow.onload = () => {
                printWindow.print();
            };
        }
    }

    /**
     * Download a PDF document
     */
    downloadPdf(doc: jsPDF, filename: string): void {
        doc.save(filename);
    }

    /**
     * Helper: Format date
     */
    private formatDate(date: any): string {
        if (!date) return '';
        const d = date.toDate ? date.toDate() : new Date(date);
        return d.toLocaleDateString('es-MX', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

    /**
     * Helper: Format currency
     */
    private formatCurrency(amount: number): string {
        return new Intl.NumberFormat('es-MX', {
            style: 'currency',
            currency: 'MXN'
        }).format(amount);
    }

    /**
     * Helper: Format payment method
     */
    private formatPaymentMethod(method?: string): string {
        const methods: Record<string, string> = {
            'stripe': 'Tarjeta de Crédito',
            'paypal': 'PayPal',
            'bank_transfer': 'Transferencia Bancaria',
            'cash': 'Efectivo'
        };
        return methods[method || ''] || 'N/A';
    }
}
