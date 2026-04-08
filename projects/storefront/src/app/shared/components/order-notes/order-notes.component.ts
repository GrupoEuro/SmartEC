import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OrderNoteService } from '../../../core/services/order-note.service';
import { OrderNote, NoteType } from '../../../core/models/order-note.model';
import { UserProfile } from '../../../core/models/user.model';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../core/services/toast.service';

@Component({
    selector: 'app-order-notes',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './order-notes.component.html',
    styleUrls: ['./order-notes.component.css']
})
export class OrderNotesComponent implements OnInit {
    @Input() orderId!: string;

    private noteService = inject(OrderNoteService);
    private authService = inject(AuthService);
    private toast = inject(ToastService);

    // State
    notes = signal<OrderNote[]>([]);
    isLoading = signal<boolean>(false);
    isAdding = signal<boolean>(false);
    currentUser = signal<UserProfile | null>(null);

    // Form
    newNoteText = signal<string>('');
    newNoteType = signal<NoteType>('info');
    showAddForm = signal<boolean>(false);

    // Edit mode
    editingNoteId = signal<string | null>(null);
    editNoteText = signal<string>('');

    async ngOnInit() {
        await this.loadCurrentUser();
        await this.loadNotes();
    }

    async loadCurrentUser() {
        const user = await this.authService.getCurrentUser();
        this.currentUser.set(user);
    }

    async loadNotes() {
        if (!this.orderId) return;

        this.isLoading.set(true);
        try {
            this.noteService.getOrderNotes(this.orderId).subscribe({
                next: (notes) => {
                    this.notes.set(notes);
                    this.isLoading.set(false);
                },
                error: (error) => {
                    console.error('Error loading notes:', error);
                    this.toast.error('Error al cargar las notas');
                    this.isLoading.set(false);
                }
            });
        } catch (error) {
            console.error('Error loading notes:', error);
            this.isLoading.set(false);
        }
    }

    toggleAddForm() {
        this.showAddForm.set(!this.showAddForm());
        if (!this.showAddForm()) {
            this.resetForm();
        }
    }

    resetForm() {
        this.newNoteText.set('');
        this.newNoteType.set('info');
    }

    async addNote() {
        const text = this.newNoteText().trim();
        if (!text || !this.currentUser()) return;

        this.isAdding.set(true);
        try {
            const user = this.currentUser()!;
            await this.noteService.addNote(
                this.orderId,
                text,
                user.uid,
                user.displayName || user.email,
                this.newNoteType(),
                true // Always internal for operations
            );

            this.toast.success('Nota agregada correctamente');
            this.resetForm();
            this.showAddForm.set(false);
            await this.loadNotes();
        } catch (error) {
            console.error('Error adding note:', error);
            this.toast.error('Error al agregar la nota');
        } finally {
            this.isAdding.set(false);
        }
    }

    startEdit(note: OrderNote) {
        this.editingNoteId.set(note.id!);
        this.editNoteText.set(note.text);
    }

    cancelEdit() {
        this.editingNoteId.set(null);
        this.editNoteText.set('');
    }

    async saveEdit(noteId: string) {
        const text = this.editNoteText().trim();
        if (!text) return;

        try {
            await this.noteService.updateNote(noteId, text);
            this.toast.success('Nota actualizada correctamente');
            this.cancelEdit();
            await this.loadNotes();
        } catch (error) {
            console.error('Error updating note:', error);
            this.toast.error('Error al actualizar la nota');
        }
    }

    async deleteNote(noteId: string) {
        if (!confirm('Are you sure you want to delete this note?')) return;

        try {
            await this.noteService.deleteNote(noteId);
            this.toast.success('Nota eliminada correctamente');
            await this.loadNotes();
        } catch (error) {
            console.error('Error deleting note:', error);
            this.toast.error('Error al eliminar la nota');
        }
    }

    async resolveIssue(noteId: string) {
        try {
            await this.noteService.resolveIssue(noteId);
            this.toast.success('Incidencia marcada como resuelta');
            await this.loadNotes();
        } catch (error) {
            console.error('Error resolving issue:', error);
            this.toast.error('Error al resolver la incidencia');
        }
    }

    getNoteTypeIcon(type: NoteType): string {
        switch (type) {
            case 'info':
                return 'fa-info-circle';
            case 'warning':
                return 'fa-exclamation-triangle';
            case 'issue':
                return 'fa-exclamation-circle';
            default:
                return 'fa-sticky-note';
        }
    }

    getNoteTypeClass(type: NoteType): string {
        switch (type) {
            case 'info':
                return 'note-info';
            case 'warning':
                return 'note-warning';
            case 'issue':
                return 'note-issue';
            default:
                return 'note-default';
        }
    }

    formatDate(date: any): string {
        if (!date) return '';
        const d = date.toDate ? date.toDate() : new Date(date);
        return d.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    getUnresolvedIssuesCount(): number {
        return this.notes().filter(n => n.type === 'issue' && !n.isResolved).length;
    }
}
