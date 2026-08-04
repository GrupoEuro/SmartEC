import { Component, signal, inject, OnInit, OnDestroy, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { InboxService, Conversation, Message, Channel, ConversationStatus } from '../services/inbox.service';
import { AuthService } from '../../../core/services/auth.service';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { UserProfile } from '../../../core/models/user.model';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { CustomerSearchModalComponent } from '../components/customer-search-modal/customer-search-modal.component';
import { AgentTransferModalComponent } from '../components/agent-transfer-modal/agent-transfer-modal.component';
import { PhoneInputComponent } from '../components/phone-input/phone-input.component';

@Component({
    selector: 'app-inbox',
    standalone: true,
    imports: [CommonModule, RouterModule, FormsModule, AppIconComponent, MatDialogModule, PhoneInputComponent],
    template: `
<div class="inbox-shell">

    <!-- ═══ LEFT PANEL — Conversation List ═══════════════════════════════════ -->
    <aside class="conv-panel" [class.hidden-mobile]="activeConversation()">

        <!-- Filters bar -->
        <div class="conv-filters">
            <!-- Assignment Tabs -->
            <div class="assign-tabs">
                <button class="assign-tab" [class.active]="assignmentFilter() === 'mine'" (click)="setAssignment('mine')">Míos</button>
                <button class="assign-tab" [class.active]="assignmentFilter() === 'unassigned'" (click)="setAssignment('unassigned')">Sin Asignar</button>
                <button class="assign-tab" [class.active]="assignmentFilter() === 'all'" (click)="setAssignment('all')">Todos</button>
            </div>
            
            <div class="status-tabs">
                @for (s of statusOptions; track s.value) {
                    <button class="status-tab" [class.active]="statusFilter() === s.value"
                            (click)="setStatus(s.value)">
                        {{ s.label }}
                        @if (s.value === 'open' && openCount() > 0 && assignmentFilter() === 'all') {
                            <span class="count-pill">{{ openCount() }}</span>
                        }
                    </button>
                }
            </div>
            <div class="channel-chips">
                <button class="ch-chip" [class.active]="!channelFilter()" (click)="setChannel(undefined)">Todos</button>
                @for (ch of channels; track ch.id) {
                    <button class="ch-chip" [class.active]="channelFilter() === ch.id"
                            (click)="setChannel(ch.id)" [style.--ch-color]="ch.color">
                        <app-icon [name]="ch.icon" [size]="13"></app-icon>
                        {{ ch.label }}
                    </button>
                }
            </div>
        </div>

        <!-- Conversation list -->
        <div class="conv-list">
            @if (loading()) {
                <div class="state-msg"><div class="spinner"></div><span>Cargando…</span></div>
            } @else if (conversations().length === 0) {
                <div class="state-msg empty">
                    <app-icon name="inbox" [size]="32"></app-icon>
                    <span>Sin conversaciones</span>
                </div>
            } @else {
                @for (conv of conversations(); track conv.id) {
                    <div class="conv-item" [class.active]="activeConversation()?.id === conv.id"
                         [class.unread]="conv.unreadCount > 0"
                         (click)="openConversation(conv)">
                        <!-- Avatar -->
                        <div class="conv-avatar" [style.border-color]="svc.channelColor(conv.channel)">
                            @if (conv.customerAvatar) {
                                <img [src]="conv.customerAvatar" [alt]="conv.customerName">
                            } @else {
                                <span class="conv-initials">{{ initials(conv.customerName) }}</span>
                            }
                            <span class="ch-dot" [style.background]="svc.channelColor(conv.channel)"></span>
                        </div>
                        <!-- Info -->
                        <div class="conv-info">
                            <div class="conv-top">
                                <span class="conv-name">{{ conv.customerName }}</span>
                                <span class="conv-time" [title]="formatFullDateTime(conv.lastMessage?.timestamp)">{{ conv.lastMessage?.timestamp ? svc.timeAgo(conv.lastMessage.timestamp) : '' }}</span>
                            </div>
                            <div class="conv-preview">
                                @if (conv.lastMessage?.direction === 'outbound') {
                                    <span class="preview-agent">Tú: </span>
                                }
                                <span class="preview-text">{{ conv.lastMessage?.text | slice:0:60 }}</span>
                            </div>
                            @if (conv.unreadCount > 0) {
                                <span class="unread-badge">{{ conv.unreadCount }}</span>
                            }
                        </div>
                    </div>
                }
            }
        </div>
    </aside>

    <!-- ═══ RIGHT PANEL — Thread ══════════════════════════════════════════════ -->
    <section class="thread-panel" [class.hidden-mobile]="!activeConversation()">

        @if (!activeConversation()) {
            <div class="empty-thread">
                <app-icon name="message-square" [size]="48"></app-icon>
                <h3>Selecciona una conversación</h3>
                <p>Elige una conversación de la lista para ver los mensajes</p>
            </div>
        } @else {
            <!-- Thread header -->
            <div class="thread-header">
                <button class="back-btn" (click)="activeConversation.set(null)">
                    <app-icon name="arrow-left" [size]="18"></app-icon>
                </button>
                <div class="thread-avatar" [style.border-color]="svc.channelColor(activeConversation()!.channel)">
                    @if (activeConversation()!.customerAvatar) {
                        <img [src]="activeConversation()!.customerAvatar" alt="">
                    } @else {
                        <span>{{ initials(activeConversation()!.customerName) }}</span>
                    }
                </div>
                <div class="thread-customer-info">
                    <span class="thread-name">{{ activeConversation()!.customerName }}</span>
                    <span class="thread-handle" [style.color]="svc.channelColor(activeConversation()!.channel)">
                        <app-icon [name]="svc.channelIcon(activeConversation()!.channel)" [size]="12"></app-icon>
                        {{ svc.channelLabel(activeConversation()!.channel) }} · {{ activeConversation()!.customerHandle }}
                    </span>
                </div>
                <div class="thread-actions">
                    <span class="status-pill" [class]="'status-' + activeConversation()!.status">
                        {{ statusLabel(activeConversation()!.status) }}
                    </span>
                    @if (!activeConversation()!.assignedTo) {
                        <button class="action-btn claim-btn" (click)="claimConversation()" title="Asignarme esta conversación">
                            <app-icon name="user-plus" [size]="16"></app-icon>
                            Asignarme
                        </button>
                    } @else if (activeConversation()!.assignedTo === currentUser()?.uid) {
                        <button class="action-btn transfer-btn" (click)="transferConversation()" title="Liberar o transferir">
                            <app-icon name="corner-up-right" [size]="16"></app-icon>
                            Transferir
                        </button>
                    }
                    @if (activeConversation()!.status !== 'resolved') {
                        <button class="action-btn resolve-btn" (click)="resolve()" title="Marcar resuelto">
                            <app-icon name="check-circle" [size]="16"></app-icon>
                            Resolver
                        </button>
                    }
                </div>
            </div>

            <!-- Messages -->
            <div class="messages-area" #messagesArea>
                @if (messagesLoading()) {
                    <div class="state-msg"><div class="spinner"></div></div>
                } @else {
                    @for (msg of messages(); track msg.id) {
                        <div class="msg-row" [class.outbound]="msg.direction === 'outbound'">
                            <div class="msg-bubble" [class.out-bubble]="msg.direction === 'outbound' && msg.type !== 'comment'" [class.internal-note]="msg.type === 'comment'">
                                @if (msg.type === 'comment') {
                                    <div class="note-header"><app-icon name="lock" [size]="12"></app-icon> Nota Interna</div>
                                }
                                @if (msg.type === 'image' && msg.mediaUrl) {
                                    <img class="msg-image" [src]="msg.mediaUrl" alt="Imagen">
                                } @else if (msg.type === 'document' && msg.mediaUrl) {
                                    <a class="msg-doc" [href]="msg.mediaUrl" target="_blank">
                                        <app-icon name="file" [size]="16"></app-icon>
                                        Documento adjunto
                                    </a>
                                } @else {
                                    <p class="msg-text">{{ msg.content }}</p>
                                }
                                <div class="msg-meta">
                                    @if (msg.direction === 'outbound' && msg.sentByName) {
                                        <span class="msg-agent">{{ msg.sentByName }}</span>
                                    }
                                    <span class="msg-time" [title]="formatFullDateTime(msg.timestamp)">{{ formatTime(msg.timestamp) }}</span>
                                    @if (msg.direction === 'outbound') {
                                        <app-icon [name]="msg.status === 'read' ? 'check-check' : 'check'" [size]="12" class="msg-status-icon"></app-icon>
                                    }
                                </div>
                            </div>
                        </div>
                    }
                }
            </div>

            <!-- Reply composer -->
            <div class="composer-wrapper">
                @if (activeConversation()!.assignedTo && activeConversation()!.assignedTo !== currentUser()?.uid) {
                    <div class="composer-locked">
                        <app-icon name="lock" [size]="20"></app-icon>
                        <span>Conversación asignada a otro agente.</span>
                    </div>
                } @else if (activeConversation()!.channel === 'mercadolibre') {
                    <div class="composer-locked">
                        <app-icon name="external-link" [size]="20"></app-icon>
                        <span>Las respuestas a MercadoLibre deben realizarse desde su plataforma.</span>
                        <a [href]="activeConversation()!.tags.includes('Pre-Venta') ? 'https://www.mercadolibre.com.mx/preguntas' : 'https://www.mercadolibre.com.mx/mensajes/buzon/' + activeConversation()!.channelConversationId" target="_blank" class="btn-claim-primary" style="text-decoration:none; margin-top:0.5rem">
                            Responder en MercadoLibre
                        </a>
                    </div>
                } @else if (!activeConversation()!.assignedTo) {
                    <div class="composer-locked claim-prompt">
                        <span>Debes asignarte esta conversación para poder responder.</span>
                        <button class="btn-claim-primary" (click)="claimConversation()">Asignarme ahora</button>
                    </div>
                } @else {
                    <div class="composer">
                        <textarea class="composer-input"
                                  [(ngModel)]="replyText"
                                  placeholder="Escribe un mensaje al cliente…"
                                  rows="1"
                                  (keydown.enter)="onEnter($event)"
                                  [disabled]="sending()">
                        </textarea>
                        <button class="send-btn" (click)="sendReply()"
                                [disabled]="!replyText.trim() || sending()">
                            @if (sending()) {
                                <div class="send-spinner"></div>
                            } @else {
                                <app-icon name="send" [size]="18"></app-icon>
                            }
                        </button>
                    </div>
                }
            </div>
        }
    </section>

    <!-- ═══ RIGHT PANEL — Customer Context ════════════════════════════════════ -->
    @if (activeConversation()) {
        <aside class="context-panel hidden-mobile">
            <div class="context-header">
                <h3>Cliente 360</h3>
                @if (activeConversation()!.customerId) {
                    <button class="ctx-edit-btn" (click)="toggleEditProfile()" [title]="editingProfile() ? 'Cancelar edición' : 'Editar datos del cliente'">
                        <app-icon [name]="editingProfile() ? 'x' : 'edit'" [size]="15"></app-icon>
                    </button>
                }
            </div>
            <div class="context-content">
                @if (contextLoading()) {
                    <div class="state-msg"><div class="spinner"></div></div>
                } @else if (!activeConversation()!.customerId) {
                    <!-- ── Unlinked State ── -->
                    <div class="unlinked-state">
                        <app-icon name="user-x" [size]="48"></app-icon>
                        <h4>Cliente no asociado</h4>
                        <p>Vincula este canal de comunicación a un cliente existente en la base de datos.</p>
                        <button class="btn-link-customer" (click)="linkCustomer()">
                            <app-icon name="link" [size]="16"></app-icon> Asociar a Cliente
                        </button>

                        @if (suggestedMatch()) {
                            <div class="suggested-match-box">
                                <div class="sm-header">
                                    <app-icon name="sparkles" [size]="16"></app-icon>
                                    <span>Coincidencia MeLi Detectada</span>
                                </div>
                                <p class="sm-desc">Se encontró historial de compra en MercadoLibre asociado a este contacto:</p>
                                <div class="sm-details">
                                    <span class="sm-name">{{ suggestedMatch()!.displayName }}</span>
                                    <span class="sm-info">{{ suggestedMatch()!.meliOrdersCount }} compra(s) previa(s) en MercadoLibre</span>
                                </div>
                                <button class="btn-auto-link" (click)="autoLinkSuggestedMatch()">
                                    <app-icon name="link" [size]="14"></app-icon> Vincular Automáticamente
                                </button>
                            </div>
                        }
                    </div>
                } @else {
                    <!-- ── Linked Customer: EDIT MODE ── -->
                    @if (editingProfile()) {
                        <div class="profile-edit-card">
                            <div class="edit-card-title">
                                <app-icon name="edit" [size]="14"></app-icon>
                                <span>Editar Datos del Cliente</span>
                            </div>
                            <div class="edit-field-group">
                                <label class="edit-label">Nombre</label>
                                <input class="edit-input" type="text" [(ngModel)]="profileDraft.name" placeholder="Nombre completo">
                            </div>
                            <div class="edit-field-group">
                                <label class="edit-label">Email</label>
                                <input class="edit-input" type="email" [(ngModel)]="profileDraft.email" placeholder="correo@ejemplo.com">
                            </div>
                            <div class="edit-field-group">
                                <label class="edit-label">Teléfono / WhatsApp</label>
                                <app-phone-input [(ngModel)]="profileDraft.fullPhone"></app-phone-input>
                            </div>
                            <div class="edit-field-group">
                                <label class="edit-label">Etiquetas</label>
                                <div class="edit-tags-row">
                                    @for (tag of availableTags; track tag.value) {
                                        <button class="edit-tag-chip"
                                                [class.selected]="profileDraft.tags.includes(tag.value)"
                                                (click)="toggleTag(tag.value)">
                                            {{ tag.label }}
                                        </button>
                                    }
                                </div>
                            </div>
                            <div class="edit-actions">
                                <button class="btn-edit-cancel" (click)="toggleEditProfile()">Cancelar</button>
                                <button class="btn-edit-save" (click)="saveProfileDraft()" [disabled]="savingProfile()">
                                    @if (savingProfile()) { <div class="spinner-sm"></div> } @else { Guardar }
                                </button>
                            </div>
                        </div>
                    } @else {
                        <!-- ── Linked Customer: VIEW MODE ── -->
                        <div class="profile-card">
                            <div class="profile-header">
                                <div class="profile-avatar">
                                    @if (customerProfile()?.photoURL) {
                                        <img [src]="customerProfile()!.photoURL" alt="">
                                    } @else {
                                        <span>{{ initials(customerDisplayName()) }}</span>
                                    }
                                </div>
                                <div class="profile-titles">
                                    <span class="p-name">{{ customerDisplayName() }}</span>
                                    <span class="p-email">{{ customerEmail() }}</span>
                                    @if (customerPhone()) {
                                        <span class="p-phone">{{ customerPhone() }}</span>
                                    }
                                </div>
                            </div>

                            <!-- Customer Tags -->
                            @if (customerTagsList().length > 0) {
                                <div class="tag-row">
                                    @for (t of customerTagsList(); track t) {
                                        <span class="tag-chip">{{ t }}</span>
                                    }
                                </div>
                            }

                            @if (meliStats()?.isRecurrent) {
                                <div class="meli-vip-card">
                                    <div class="m-vip-header">
                                        <app-icon name="shopping-bag" [size]="15"></app-icon>
                                        <span>Cliente Recurrente MercadoLibre</span>
                                    </div>
                                    <div class="m-vip-stats">
                                        <div class="m-vip-box">
                                            <span class="m-vip-lbl">Compras MeLi</span>
                                            <span class="m-vip-val">{{ meliStats()!.meliCount }}</span>
                                        </div>
                                        <div class="m-vip-box">
                                            <span class="m-vip-lbl">Monto MeLi</span>
                                            <span class="m-vip-val">{{ meliStats()!.meliTotalSpend | currency }}</span>
                                        </div>
                                    </div>
                                </div>
                            }

                            <div class="profile-stats">
                                <div class="stat-box">
                                    <span class="stat-lbl">Pedidos</span>
                                    <span class="stat-val">{{ customerTotalOrders() }}</span>
                                </div>
                                <div class="stat-box">
                                    <span class="stat-lbl">LTV Total</span>
                                    <span class="stat-val">{{ customerTotalSpend() | currency }}</span>
                                </div>
                            </div>

                            <!-- Quick Contact Actions -->
                            @if (customerPhone() || customerEmail()) {
                                <div class="quick-actions">
                                    @if (customerPhone()) {
                                        <a class="quick-btn wa-btn"
                                           [href]="'https://wa.me/' + whatsappNumber()"
                                           target="_blank" rel="noopener"
                                           title="Abrir WhatsApp">
                                            <app-icon name="message-circle" [size]="14"></app-icon>
                                            WhatsApp
                                        </a>
                                        <button class="quick-btn copy-btn" (click)="copyPhone()" title="Copiar teléfono">
                                            <app-icon name="copy" [size]="14"></app-icon>
                                            Copiar
                                        </button>
                                    }
                                    @if (customerEmail()) {
                                        <a class="quick-btn email-btn"
                                           [href]="'mailto:' + customerEmail()"
                                           title="Enviar email">
                                            <app-icon name="mail" [size]="14"></app-icon>
                                            Email
                                        </a>
                                    }
                                </div>
                            }
                        </div>
                    }

                    <!-- ── Customer Notes History ── -->
                    @if (customerNotes().length > 0) {
                        <div class="context-section">
                            <h4 class="section-title">Notas del Cliente</h4>
                            <div class="note-history-list">
                                @for (n of customerNotes(); track n.id) {
                                    <div class="note-history-item">
                                        <div class="n-head">
                                            <span class="n-agent">{{ n.agentName }}</span>
                                            <div class="n-head-right">
                                                <span class="n-time" [title]="formatFullDateTime(n.timestamp)">{{ formatTime(n.timestamp) }}</span>
                                                <button class="n-delete-btn" (click)="deleteNote(n.id)" title="Eliminar nota">
                                                    <app-icon name="trash" [size]="11"></app-icon>
                                                </button>
                                            </div>
                                        </div>
                                        <div class="n-text">{{ n.text }}</div>
                                    </div>
                                }
                            </div>
                        </div>
                    }

                    <!-- ── Internal Notes Composer ── -->
                    <div class="context-section">
                        <h4 class="section-title">Agregar Nota Interna</h4>
                        <div class="internal-note-box">
                            <textarea class="note-input" [(ngModel)]="noteText"
                                      placeholder="Ctrl+Enter para guardar…"
                                      rows="2"
                                      [disabled]="sendingNote()"
                                      (keydown)="onNoteKeydown($event)"></textarea>
                            <div class="note-actions">
                                <button class="btn-note-save" (click)="sendInternalNote()" [disabled]="!noteText.trim() || sendingNote()">
                                    @if (sendingNote()) {
                                        <div class="spinner-sm"></div>
                                    } @else {
                                        Guardar Nota
                                    }
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- ── Recent Orders ── -->
                    <div class="context-section">
                        <h4 class="section-title">Últimos Pedidos</h4>
                        @if (customerOrders().length === 0) {
                            <p class="empty-text">Sin pedidos recientes.</p>
                        } @else {
                            <div class="order-list">
                                @for (o of customerOrders(); track o.id) {
                                    <div class="order-item">
                                        <div class="order-top">
                                            <span class="o-id">#{{ o.id.slice(-6).toUpperCase() }}</span>
                                            <span class="o-ch-badge" [class.ch-meli]="isMeliOrder(o)">
                                                {{ getOrderChannelLabel(o) }}
                                            </span>
                                            <span class="o-status">{{ o.status }}</span>
                                        </div>
                                        @if (getOrderProductSummary(o)) {
                                            <div class="o-product">{{ getOrderProductSummary(o) }}</div>
                                        }
                                        <div class="order-bot">
                                            <span class="o-date" [title]="formatFullDateTime(o.createdAt)">{{ formatTime(o.createdAt) }}</span>
                                            <div class="o-bot-right">
                                                <span class="o-total">{{ o.total | currency }}</span>
                                                <a class="o-view-btn" [routerLink]="['/admin/orders', o.id]" title="Ver pedido completo">
                                                    <app-icon name="external-link" [size]="11"></app-icon>
                                                </a>
                                            </div>
                                        </div>
                                    </div>
                                }
                            </div>
                        }
                    </div>

                    <!-- ── Past Conversations / Tickets ── -->
                    <div class="context-section">
                        <h4 class="section-title">Historial de Contacto</h4>
                        @if (customerHistory().length === 0) {
                            <p class="empty-text">Sin tickets anteriores.</p>
                        } @else {
                            <div class="order-list">
                                @for (h of customerHistory(); track h.id) {
                                    <div class="order-item ticket-item">
                                        <div class="order-top">
                                            <div class="ticket-info">
                                                <app-icon [name]="getChannelIcon(h.channel)" [size]="12"></app-icon>
                                                <span class="o-id">{{ h.channel | uppercase }}</span>
                                            </div>
                                            <span class="o-status status-{{h.status}}">{{ h.status }}</span>
                                        </div>
                                        <div class="order-bot">
                                            <span class="o-date" [title]="formatFullDateTime(h.updatedAt)">{{ formatTime(h.updatedAt) }}</span>
                                            <button class="view-btn" (click)="openConversation(h)">Ver</button>
                                        </div>
                                    </div>
                                }
                            </div>
                        }
                    </div>

                    <button class="btn-unlink" (click)="unlinkCustomer()" title="Desvincular">
                        <app-icon name="unlink" [size]="16"></app-icon> Desvincular canal
                    </button>
                }
            </div>
        </aside>
    }
</div>
    `,
    styles: [`
        .inbox-shell { display: flex; height: calc(100vh - 56px); overflow: hidden; background: #0f172a; }

        /* ── Left Panel ── */
        .conv-panel { width: 320px; flex-shrink: 0; border-right: 1px solid #334155; display: flex; flex-direction: column; background: #1e293b; }

        .conv-filters { padding: .75rem; border-bottom: 1px solid #334155; display: flex; flex-direction: column; gap: .75rem; }

        .assign-tabs { display: flex; background: #0f172a; border-radius: 8px; padding: .2rem; border: 1px solid #334155; }
        .assign-tab { flex: 1; padding: .35rem; border: none; background: transparent; color: #94a3b8; border-radius: 6px; font-size: .75rem; font-weight: 600; cursor: pointer; transition: all .2s; }
        .assign-tab.active { background: #334155; color: #f8fafc; box-shadow: 0 2px 5px rgba(0,0,0,.2); }

        .status-tabs { display: flex; gap: .25rem; }
        .status-tab { flex: 1; padding: .4rem .5rem; border: none; border-radius: 7px; background: transparent; color: #71717a; font-size: .78rem; font-weight: 600; cursor: pointer; transition: all .18s; position: relative; }
        .status-tab:hover { background: rgba(255,255,255,.05); color: #e4e4e7; }
        .status-tab.active { background: rgba(16,185,129,.15); color: #6ee7b7; }
        .count-pill { display: inline-flex; align-items: center; justify-content: center; background: #10b981; color: #fff; border-radius: 10px; font-size: .6rem; font-weight: 800; padding: .1rem .35rem; margin-left: .3rem; min-width: 18px; }

        .channel-chips { display: flex; flex-wrap: wrap; gap: .25rem; }
        .ch-chip { padding: .25rem .6rem; border-radius: 20px; border: 1px solid rgba(255,255,255,.08); background: transparent; color: #71717a; font-size: .7rem; font-weight: 600; cursor: pointer; transition: all .18s; display: flex; align-items: center; gap: .25rem; }
        .ch-chip:hover { border-color: rgba(255,255,255,.2); color: #e4e4e7; }
        .ch-chip.active { background: var(--ch-color, #10b981); color: #fff; border-color: transparent; opacity: .9; }

        .conv-list { flex: 1; overflow-y: auto; }
        .conv-list::-webkit-scrollbar { width: 4px; }
        .conv-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,.06); border-radius: 2px; }

        .conv-item { display: flex; gap: .75rem; padding: .85rem 1rem; cursor: pointer; border-bottom: 1px solid #334155; transition: background .15s; position: relative; }
        .conv-item:hover { background: #334155; }
        .conv-item.active { background: rgba(16,185,129,.1); border-left: 2.5px solid #10b981; }
        .conv-item.unread .conv-name { font-weight: 800; color: #f8fafc; }

        .conv-avatar { width: 40px; height: 40px; border-radius: 50%; border: 2px solid; flex-shrink: 0; overflow: visible; position: relative; background: #334155; display: flex; align-items: center; justify-content: center; }
        .conv-avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
        .conv-initials { font-size: .85rem; font-weight: 700; color: #cbd5e1; }
        .ch-dot { position: absolute; bottom: -1px; right: -1px; width: 11px; height: 11px; border-radius: 50%; border: 2px solid #1e293b; }

        .conv-info { flex: 1; min-width: 0; }
        .conv-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: .2rem; }
        .conv-name { font-size: .84rem; font-weight: 600; color: #d4d4d8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .conv-time { font-size: .68rem; color: #52525b; flex-shrink: 0; margin-left: .5rem; }
        .conv-preview { font-size: .77rem; color: #52525b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .preview-agent { color: #71717a; font-weight: 600; }
        .preview-text { }
        .unread-badge { position: absolute; top: .85rem; right: 1rem; background: #10b981; color: #fff; border-radius: 10px; font-size: .6rem; font-weight: 800; padding: .1rem .4rem; min-width: 18px; text-align: center; }

        .state-msg { display: flex; flex-direction: column; align-items: center; gap: .75rem; padding: 3rem 1rem; color: #52525b; font-size: .85rem; }
        .state-msg.empty { color: #3f3f46; }

        /* ── Right Panel ── */
        .thread-panel { flex: 1; display: flex; flex-direction: column; min-width: 0; background: #0f172a; }
        .empty-thread { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem; color: #94a3b8; text-align: center; padding: 2rem; }
        .empty-thread h3 { font-size: 1.1rem; font-weight: 700; color: #cbd5e1; margin: 0; }
        .empty-thread p { font-size: .85rem; margin: 0; }

        .thread-header { display: flex; align-items: center; gap: .75rem; padding: .875rem 1.25rem; border-bottom: 1px solid #334155; background: #1e293b; flex-shrink: 0; }
        .back-btn { display: none; background: transparent; border: none; color: #94a3b8; cursor: pointer; padding: .3rem; border-radius: 7px; }
        .thread-avatar { width: 38px; height: 38px; border-radius: 50%; border: 2px solid; flex-shrink: 0; background: #334155; display: flex; align-items: center; justify-content: center; overflow: hidden; font-size: .85rem; font-weight: 700; color: #cbd5e1; }
        .thread-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .thread-customer-info { flex: 1; min-width: 0; }
        .thread-name { display: block; font-size: .9rem; font-weight: 700; color: #f4f4f5; }
        .thread-handle { display: flex; align-items: center; gap: .3rem; font-size: .72rem; font-weight: 500; }
        .thread-actions { display: flex; align-items: center; gap: .5rem; }

        .status-pill { padding: .2rem .6rem; border-radius: 20px; font-size: .68rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
        .status-open     { background: rgba(16,185,129,.15);  color: #6ee7b7; }
        .status-pending  { background: rgba(245,158,11,.15);  color: #fcd34d; }
        .status-resolved { background: rgba(113,113,122,.15); color: #a1a1aa; }
        .status-snoozed  { background: rgba(99,102,241,.15);  color: #a5b4fc; }

        .action-btn { display: flex; align-items: center; gap: .35rem; padding: .35rem .75rem; border-radius: 8px; border: none; cursor: pointer; font-size: .78rem; font-weight: 600; transition: all .18s; }
        .resolve-btn { background: rgba(16,185,129,.15); color: #6ee7b7; }
        .resolve-btn:hover { background: rgba(16,185,129,.25); }
        .claim-btn { background: rgba(59,130,246,.15); color: #93c5fd; }
        .claim-btn:hover { background: rgba(59,130,246,.25); }
        .transfer-btn { background: rgba(255,255,255,.05); color: #d4d4d8; }
        .transfer-btn:hover { background: rgba(255,255,255,.1); }

        /* Messages */
        .messages-area { flex: 1; overflow-y: auto; padding: 1.25rem; display: flex; flex-direction: column; gap: .75rem; }
        .messages-area::-webkit-scrollbar { width: 5px; }
        .messages-area::-webkit-scrollbar-thumb { background: rgba(255,255,255,.06); border-radius: 3px; }

        .msg-row { display: flex; }
        .msg-row.outbound { justify-content: flex-end; }
        .msg-bubble { max-width: 72%; background: #1e293b; border: 1px solid #334155; border-radius: 14px 14px 14px 4px; padding: .65rem .9rem; box-shadow: 0 1px 2px rgba(0,0,0,.1); }
        .out-bubble { background: #10b981; border-color: #059669; border-radius: 14px 14px 4px 14px; }
        .internal-note { background: #f59e0b; border-color: #d97706; border-radius: 14px 14px 4px 14px; }
        .note-header { font-size: .65rem; font-weight: 800; color: #78350f; text-transform: uppercase; letter-spacing: .05em; display: flex; align-items: center; gap: .25rem; margin-bottom: .25rem; }
        .msg-text { font-size: .85rem; color: #e4e4e7; margin: 0; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
        .out-bubble .msg-text, .internal-note .msg-text { color: #ffffff; }
        .msg-image { max-width: 100%; border-radius: 8px; }
        .msg-doc { display: flex; align-items: center; gap: .4rem; color: #a5b4fc; font-size: .82rem; text-decoration: none; }
        .msg-meta { display: flex; align-items: center; gap: .35rem; margin-top: .35rem; }
        .msg-agent { font-size: .65rem; font-weight: 600; color: #10b981; }
        .msg-time { font-size: .65rem; color: #94a3b8; }
        .out-bubble .msg-time, .internal-note .msg-time { color: rgba(255,255,255,.8); }
        .msg-status-icon { color: rgba(255,255,255,.9); }

        /* Composer */
        .composer-wrapper { border-top: 1px solid #334155; background: #1e293b; flex-shrink: 0; }
        .composer-locked { padding: 1.5rem; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .75rem; color: #94a3b8; font-size: .9rem; text-align: center; }
        .btn-claim-primary { background: #3b82f6; color: #fff; border: none; border-radius: 8px; padding: .5rem 1rem; font-weight: 600; cursor: pointer; transition: all .2s; }
        .btn-claim-primary:hover { background: #2563eb; }

        .composer-input { flex: 1; background: #0f172a; border: 1px solid #334155; border-radius: 12px; padding: .65rem .9rem; color: #f8fafc; font-size: .88rem; font-family: inherit; resize: none; outline: none; transition: border-color .18s; min-height: 44px; max-height: 140px; overflow-y: auto; line-height: 1.5; }
        .composer-input:focus { border-color: rgba(16,185,129,.4); }
        .composer-input::placeholder { color: #52525b; }
        .composer { padding: 1.25rem; display: flex; gap: .75rem; align-items: flex-end; }
        .send-btn { width: 44px; height: 44px; border-radius: 12px; border: none; background: #10b981; color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all .2s; flex-shrink: 0; }
        .send-btn:hover:not(:disabled) { background: #059669; }
        .send-btn:disabled { opacity: .5; cursor: not-allowed; }

        /* Spinners */
        .spinner, .send-spinner { width: 20px; height: 20px; border: 2px solid rgba(255,255,255,.15); border-top-color: #10b981; border-radius: 50%; animation: spin .7s linear infinite; }
        .send-spinner { width: 18px; height: 18px; border-top-color: #fff; }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* ── Right Panel (Context) ── */
        .context-panel { width: 300px; flex-shrink: 0; border-left: 1px solid #334155; display: flex; flex-direction: column; background: #1e293b; }
        .context-header { padding: 1.15rem 1.25rem; border-bottom: 1px solid #334155; }
        .context-header h3 { margin: 0; font-size: .95rem; font-weight: 700; color: #f8fafc; }
        .context-content { flex: 1; overflow-y: auto; padding: 1.25rem; display: flex; flex-direction: column; gap: 1.5rem; }
        .context-content::-webkit-scrollbar { width: 4px; }
        .context-content::-webkit-scrollbar-thumb { background: rgba(255,255,255,.06); border-radius: 2px; }

        .unlinked-state { display: flex; flex-direction: column; align-items: center; gap: 1rem; color: #52525b; text-align: center; padding: 2rem 0; }
        .unlinked-state h4 { color: #d4d4d8; margin: 0; font-size: 1rem; }
        .unlinked-state p { font-size: .85rem; margin: 0; line-height: 1.4; }
        .btn-link-customer { display: flex; align-items: center; gap: .5rem; background: rgba(59,130,246,.15); color: #60a5fa; border: 1px solid rgba(59,130,246,.3); border-radius: 8px; padding: .6rem 1rem; font-size: .85rem; font-weight: 600; cursor: pointer; transition: all .2s; margin-top: .5rem; }
        .btn-link-customer:hover { background: rgba(59,130,246,.25); }

        .profile-card { background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.06); border-radius: 12px; padding: 1rem; display: flex; flex-direction: column; gap: 1rem; }
        .profile-header { display: flex; align-items: center; gap: .75rem; }
        .profile-avatar { width: 44px; height: 44px; border-radius: 50%; background: rgba(255,255,255,.1); display: flex; align-items: center; justify-content: center; overflow: hidden; font-weight: 700; color: #d4d4d8; }
        .profile-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .profile-titles { display: flex; flex-direction: column; }
        .p-name { font-size: .95rem; font-weight: 700; color: #f4f4f5; }
        .p-email { font-size: .75rem; color: #a1a1aa; }
        .profile-stats { display: flex; gap: .5rem; }
        .stat-box { flex: 1; background: rgba(0,0,0,.3); border-radius: 8px; padding: .6rem; display: flex; flex-direction: column; align-items: center; gap: .25rem; }
        .stat-lbl { font-size: .65rem; font-weight: 600; color: #71717a; text-transform: uppercase; letter-spacing: .05em; }
        .stat-val { font-size: .95rem; font-weight: 700; color: #10b981; }

        /* MeLi VIP Badge & Auto-Match */
        .meli-vip-card { background: linear-gradient(135deg, rgba(255,230,0,.15) 0%, rgba(245,158,11,.08) 100%); border: 1px solid rgba(255,230,0,.3); border-radius: 10px; padding: .65rem .8rem; display: flex; flex-direction: column; gap: .5rem; }
        .m-vip-header { display: flex; align-items: center; gap: .4rem; color: #ffe600; font-weight: 700; font-size: .78rem; letter-spacing: .02em; }
        .m-vip-stats { display: flex; gap: .5rem; }
        .m-vip-box { flex: 1; background: rgba(0,0,0,.35); border-radius: 6px; padding: .35rem .5rem; display: flex; flex-direction: column; align-items: center; }
        .m-vip-lbl { font-size: .6rem; color: #94a3b8; font-weight: 600; text-transform: uppercase; }
        .m-vip-val { font-size: .88rem; font-weight: 800; color: #ffe600; }

        .o-ch-badge { font-size: .62rem; font-weight: 700; padding: .15rem .4rem; border-radius: 4px; background: rgba(255,255,255,.08); color: #cbd5e1; }
        .o-ch-badge.ch-meli { background: rgba(255,230,0,.2); color: #ffe600; border: 1px solid rgba(255,230,0,.3); }

        .suggested-match-box { background: rgba(255,230,0,.08); border: 1px dashed rgba(255,230,0,.4); border-radius: 12px; padding: 1rem; display: flex; flex-direction: column; gap: .6rem; text-align: left; margin-top: .5rem; }
        .sm-header { display: flex; align-items: center; gap: .4rem; color: #ffe600; font-weight: 700; font-size: .82rem; }
        .sm-desc { font-size: .75rem; color: #cbd5e1; margin: 0; line-height: 1.3; }
        .sm-details { display: flex; flex-direction: column; gap: .15rem; background: rgba(0,0,0,.35); padding: .5rem .65rem; border-radius: 8px; }
        .sm-name { font-weight: 700; color: #f8fafc; font-size: .82rem; }
        .sm-info { font-size: .7rem; color: #ffe600; font-weight: 600; }
        .btn-auto-link { width: 100%; display: flex; align-items: center; justify-content: center; gap: .4rem; font-size: .78rem; background: #ffe600; color: #0f172a; font-weight: 700; border: none; border-radius: 8px; padding: .5rem; cursor: pointer; transition: all .2s; margin-top: .25rem; }
        .btn-auto-link:hover { background: #ebd300; }

        .context-section { display: flex; flex-direction: column; gap: .75rem; }
        .section-title { font-size: .75rem; font-weight: 700; color: #a1a1aa; text-transform: uppercase; letter-spacing: .05em; margin: 0; }
        .empty-text { font-size: .8rem; color: #52525b; margin: 0; }
        
        .note-history-list { display: flex; flex-direction: column; gap: .5rem; }
        .note-history-item { background: rgba(245,158,11,.08); border-left: 2px solid #f59e0b; border-radius: 4px; padding: .5rem .75rem; display: flex; flex-direction: column; gap: .25rem; }
        .n-head { display: flex; justify-content: space-between; align-items: center; }
        .n-agent { font-size: .65rem; font-weight: 700; color: #fbbf24; }
        .n-time { font-size: .65rem; color: #71717a; }
        .n-text { font-size: .8rem; color: #e4e4e7; line-height: 1.4; white-space: pre-wrap; }

        .internal-note-box { display: flex; flex-direction: column; gap: .5rem; }
        .note-input { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: .65rem; color: #f8fafc; font-size: .8rem; font-family: inherit; resize: none; outline: none; transition: border-color .2s; }
        .note-input:focus { border-color: rgba(245,158,11,.5); }
        .note-input::placeholder { color: #52525b; }
        .note-actions { display: flex; justify-content: flex-end; }
        .btn-note-save { background: rgba(245,158,11,.15); color: #f59e0b; border: 1px solid rgba(245,158,11,.3); border-radius: 6px; padding: .4rem .8rem; font-size: .75rem; font-weight: 600; cursor: pointer; transition: all .2s; display: flex; align-items: center; justify-content: center; min-width: 90px; }
        .btn-note-save:hover:not(:disabled) { background: rgba(245,158,11,.25); }
        .btn-note-save:disabled { opacity: .5; cursor: not-allowed; }
        .spinner-sm { width: 14px; height: 14px; border: 2px solid rgba(245,158,11,.3); border-top-color: #f59e0b; border-radius: 50%; animation: spin 1s linear infinite; }

        .order-list { display: flex; flex-direction: column; gap: .5rem; }
        .order-item { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: .6rem .8rem; display: flex; flex-direction: column; gap: .4rem; }
        .order-top, .order-bot { display: flex; justify-content: space-between; align-items: center; }
        .o-id { font-size: .8rem; font-weight: 600; color: #e4e4e7; }
        .o-status { font-size: .65rem; font-weight: 700; color: #fbbf24; background: rgba(245,158,11,.15); padding: .15rem .4rem; border-radius: 4px; }
        .o-date { font-size: .7rem; color: #94a3b8; }
        .o-total { font-size: .8rem; font-weight: 700; color: #10b981; }

        .ticket-item { background: #0f172a; border-color: #334155; }
        .ticket-info { display: flex; align-items: center; gap: .3rem; color: #cbd5e1; }
        .view-btn { background: #334155; border: none; color: #f8fafc; font-size: .65rem; padding: .25rem .5rem; border-radius: 4px; cursor: pointer; transition: all .2s; font-weight: 600; }
        .view-btn:hover { background: #475569; }

        .btn-unlink { display: flex; align-items: center; justify-content: center; gap: .5rem; background: transparent; color: #ef4444; border: 1px dashed rgba(239,68,68,.3); border-radius: 8px; padding: .6rem; font-size: .8rem; font-weight: 600; cursor: pointer; transition: all .2s; margin-top: auto; }
        .btn-unlink:hover { background: rgba(239,68,68,.1); border-color: #ef4444; }

        /* ── Profile Edit Card ── */
        .context-header { padding: 1.15rem 1.25rem; border-bottom: 1px solid #334155; display: flex; align-items: center; justify-content: space-between; }
        .ctx-edit-btn { background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); color: #94a3b8; border-radius: 7px; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all .2s; }
        .ctx-edit-btn:hover { background: rgba(99,102,241,.2); color: #a5b4fc; border-color: rgba(99,102,241,.4); }

        .profile-edit-card { background: rgba(99,102,241,.07); border: 1px solid rgba(99,102,241,.25); border-radius: 14px; padding: 1.1rem; display: flex; flex-direction: column; gap: .85rem; }
        .edit-card-title { display: flex; align-items: center; gap: .4rem; color: #a5b4fc; font-size: .78rem; font-weight: 700; letter-spacing: .02em; }
        .edit-field-group { display: flex; flex-direction: column; gap: .25rem; }
        .edit-label { font-size: .68rem; font-weight: 700; color: #71717a; text-transform: uppercase; letter-spacing: .05em; }
        .edit-input { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: .5rem .75rem; color: #f8fafc; font-size: .85rem; font-family: inherit; outline: none; transition: border-color .2s; width: 100%; box-sizing: border-box; }
        .edit-input:focus { border-color: rgba(99,102,241,.5); }
        .edit-tags-row { display: flex; flex-wrap: wrap; gap: .3rem; }
        .edit-tag-chip { padding: .3rem .65rem; border-radius: 20px; border: 1px solid rgba(255,255,255,.12); background: transparent; color: #71717a; font-size: .72rem; font-weight: 600; cursor: pointer; transition: all .18s; }
        .edit-tag-chip:hover { border-color: rgba(255,255,255,.25); color: #d4d4d8; }
        .edit-tag-chip.selected { background: rgba(99,102,241,.25); color: #a5b4fc; border-color: rgba(99,102,241,.5); }
        .edit-actions { display: flex; gap: .5rem; justify-content: flex-end; padding-top: .25rem; }
        .btn-edit-cancel { background: transparent; border: 1px solid rgba(255,255,255,.1); color: #71717a; border-radius: 7px; padding: .4rem .85rem; font-size: .78rem; font-weight: 600; cursor: pointer; transition: all .2s; }
        .btn-edit-cancel:hover { border-color: rgba(255,255,255,.2); color: #d4d4d8; }
        .btn-edit-save { background: rgba(99,102,241,.2); color: #a5b4fc; border: 1px solid rgba(99,102,241,.4); border-radius: 7px; padding: .4rem .85rem; font-size: .78rem; font-weight: 600; cursor: pointer; transition: all .2s; display: flex; align-items: center; gap: .4rem; min-width: 80px; justify-content: center; }
        .btn-edit-save:hover:not(:disabled) { background: rgba(99,102,241,.35); }
        .btn-edit-save:disabled { opacity: .5; cursor: not-allowed; }

        /* ── Profile View ── */
        .p-phone { font-size: .72rem; color: #60a5fa; font-weight: 600; }
        .tag-row { display: flex; flex-wrap: wrap; gap: .3rem; }
        .tag-chip { padding: .2rem .55rem; border-radius: 12px; font-size: .68rem; font-weight: 700; background: rgba(99,102,241,.2); color: #a5b4fc; border: 1px solid rgba(99,102,241,.3); letter-spacing: .02em; }

        /* ── Quick Contact Buttons ── */
        .quick-actions { display: flex; gap: .4rem; flex-wrap: wrap; }
        .quick-btn { display: flex; align-items: center; gap: .3rem; padding: .35rem .65rem; border-radius: 8px; font-size: .73rem; font-weight: 600; cursor: pointer; text-decoration: none; transition: all .18s; border: none; }
        .wa-btn { background: rgba(37,211,102,.12); color: #4ade80; border: 1px solid rgba(37,211,102,.25); }
        .wa-btn:hover { background: rgba(37,211,102,.22); }
        .email-btn { background: rgba(99,102,241,.12); color: #a5b4fc; border: 1px solid rgba(99,102,241,.25); }
        .email-btn:hover { background: rgba(99,102,241,.22); }
        .copy-btn { background: rgba(255,255,255,.05); color: #94a3b8; border: 1px solid rgba(255,255,255,.1); }
        .copy-btn:hover { background: rgba(255,255,255,.1); color: #d4d4d8; }

        /* ── Notes with delete ── */
        .n-head { display: flex; justify-content: space-between; align-items: center; }
        .n-head-right { display: flex; align-items: center; gap: .3rem; }
        .n-delete-btn { background: transparent; border: none; color: #52525b; cursor: pointer; border-radius: 4px; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; transition: all .18s; flex-shrink: 0; }
        .n-delete-btn:hover { background: rgba(239,68,68,.15); color: #f87171; }

        /* ── Order enhancements ── */
        .o-product { font-size: .72rem; color: #71717a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: .15rem 0; }
        .o-bot-right { display: flex; align-items: center; gap: .4rem; }
        .o-view-btn { display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,.07); border-radius: 5px; width: 22px; height: 22px; color: #94a3b8; transition: all .18s; text-decoration: none; }
        .o-view-btn:hover { background: rgba(99,102,241,.2); color: #a5b4fc; }

        @media (max-width: 1024px) {
            .context-panel { position: absolute; right: 0; top: 0; bottom: 0; z-index: 20; transform: translateX(100%); transition: transform .3s; }
            .context-panel.open { transform: translateX(0); box-shadow: -5px 0 25px rgba(0,0,0,.5); }
            .conv-panel { width: 100%; }
            .thread-panel { position: absolute; inset: 0; z-index: 10; }
            .back-btn { display: flex; }
            .hidden-mobile { display: none !important; }
        }
    `]
})
export class InboxComponent implements OnInit, OnDestroy {
    readonly svc = inject(InboxService);
    private readonly route = inject(ActivatedRoute);
    private readonly auth = inject(AuthService);
    private readonly dialog = inject(MatDialog);

    readonly currentUser = this.auth.currentUser;

    conversations   = signal<Conversation[]>([]);
    messages        = signal<Message[]>([]);
    activeConversation = signal<Conversation | null>(null);
    loading         = signal(true);
    messagesLoading = signal(false);
    sending         = signal(false);
    openCount       = signal(0);

    assignmentFilter = signal<'all'|'mine'|'unassigned'>('mine');
    statusFilter  = signal<ConversationStatus>('open');
    channelFilter = signal<Channel | undefined>(undefined);

    replyText = '';
    noteText = '';
    sendingNote = signal(false);

    private convSub?: Subscription;
    private msgSub?:  Subscription;

    // CRM Context
    customerProfile = signal<UserProfile | null>(null);
    customerOrders  = signal<any[]>([]);
    customerHistory = signal<Conversation[]>([]);
    customerNotes   = signal<any[]>([]);
    contextLoading  = signal(false);
    meliStats       = signal<{ meliCount: number; meliTotalSpend: number; isRecurrent: boolean; totalOrders: number } | null>(null);
    suggestedMatch  = signal<{ customerId: string; displayName: string; email?: string; phone?: string; meliOrdersCount: number; lastChannel?: string } | null>(null);

    // Profile Edit
    editingProfile  = signal(false);
    savingProfile   = signal(false);
    profileDraft    = { name: '', email: '', fullPhone: '', tags: [] as string[] };

    readonly availableTags = [
        { value: 'VIP',        label: '⭐ VIP' },
        { value: 'Mayorista',  label: '📦 Mayorista' },
        { value: 'Flotilla',   label: '🚗 Flotilla' },
        { value: 'Garantía',   label: '🛡️ Garantía' },
        { value: 'MeLi',       label: '🟡 MeLi' },
        { value: 'Recurrente', label: '🔁 Recurrente' },
    ];
    private profileSub?: Subscription;
    private ordersSub?: Subscription;
    private historySub?: Subscription;
    private notesSub?:   Subscription;

    customerTotalOrders = computed(() => {
        return this.customerProfile()?.stats?.totalOrders || this.customerOrders().length;
    });

    customerTotalSpend = computed(() => {
        if (this.customerProfile()?.stats?.totalSpend) {
            return this.customerProfile()!.stats!.totalSpend;
        }
        return this.customerOrders().reduce((acc, o) => acc + (o.total || 0), 0);
    });

    customerDisplayName = computed(() => {
        return this.customerProfile()?.displayName ||
               (this.activeConversation() as any)?.customerName ||
               this.customerOrders()[0]?.customer?.name ||
               this.customerOrders()[0]?.customer?.originalName ||
               'Cliente';
    });

    customerEmail = computed(() => {
        return this.customerProfile()?.email ||
               (this.activeConversation() as any)?.customerEmail ||
               this.customerOrders()[0]?.customer?.email ||
               '';
    });

    customerPhone = computed(() => {
        return (this.activeConversation() as any)?.customerPhone ||
               this.customerProfile()?.phone ||
               this.customerOrders()[0]?.customer?.phone ||
               '';
    });

    customerTagsList = computed(() => {
        return (this.activeConversation() as any)?.customerTags || [];
    });

    whatsappNumber = computed(() => {
        const p = this.customerPhone().replace(/\D/g, '');
        return p.length === 10 ? '52' + p : p;
    });

    readonly statusOptions: { label: string; value: ConversationStatus | 'all' }[] = [
        { label: 'Abiertos',   value: 'open'     },
        { label: 'Pendientes', value: 'pending'  },
        { label: 'Resueltos',  value: 'resolved' },
        { label: 'Todos',      value: 'all'      },
    ];

    readonly channels = [
        { id: 'whatsapp'  as Channel, label: 'WA',   icon: 'message-circle', color: '#25d366' },
        { id: 'instagram' as Channel, label: 'IG',   icon: 'instagram',      color: '#e1306c' },
        { id: 'facebook'  as Channel, label: 'FB',   icon: 'facebook',       color: '#1877f2' },
        { id: 'telegram'  as Channel, label: 'TG',   icon: 'send',           color: '#0088cc' },
        { id: 'email'     as Channel, label: 'Mail', icon: 'mail',           color: '#6366f1' },
        { id: 'website'   as Channel, label: 'Web',  icon: 'globe',          color: '#8b5cf6' },
        { id: 'mercadolibre' as Channel, label: 'MeLi', icon: 'shopping-bag', color: '#ffe600' },
    ];

    ngOnInit() {
        // Read channel from query param (sidebar channel links)
        this.route.queryParams.subscribe(params => {
            const ch = params['channel'] as Channel | undefined;
            this.channelFilter.set(ch);
            this.activeConversation.set(null);
            this.subscribeToConversations();
        });
        this.loadOpenCount();
    }

    ngOnDestroy() {
        this.convSub?.unsubscribe();
        this.msgSub?.unsubscribe();
        this.profileSub?.unsubscribe();
        this.ordersSub?.unsubscribe();
        this.historySub?.unsubscribe();
        this.notesSub?.unsubscribe();
    }

    setAssignment(type: 'all'|'mine'|'unassigned') {
        this.assignmentFilter.set(type);
        this.activeConversation.set(null);
        this.subscribeToConversations();
    }

    setStatus(status: ConversationStatus | 'all') {
        this.statusFilter.set(status as any);
        this.activeConversation.set(null);
        this.subscribeToConversations();
    }

    setChannel(channel?: Channel) {
        this.channelFilter.set(channel);
        this.activeConversation.set(null);
        this.subscribeToConversations();
    }

    getChannelIcon(channelId: Channel): string {
        return this.channels.find(c => c.id === channelId)?.icon || 'message-circle';
    }

    private subscribeToConversations() {
        this.loading.set(true);
        this.convSub?.unsubscribe();
        // Use larger limit for historical/all-status views
        const currentStatus = this.statusFilter() as string;
        const fetchLimit = (currentStatus === 'all' || currentStatus === 'resolved') ? 200 : 50;
        this.convSub = this.svc.getConversations(
            this.statusFilter(),
            this.channelFilter(),
            fetchLimit,
            this.assignmentFilter(),
            this.currentUser()?.uid
        ).subscribe(list => {
            const sorted = [...(list || [])].map(conv => {
                const n = (conv.customerName || '').toUpperCase();
                if (n.includes('BERTIN') || n.includes('VALENCIA')) {
                    conv.customerName = 'Cliente ML';
                    delete (conv as any).customerId;
                    this.svc.linkCustomer(conv.id, '', 'Cliente ML').catch(() => {});
                }
                return conv;
            }).sort((a, b) => {
                const tA = this.toJsDate(a.lastMessage?.timestamp || a.updatedAt || a.createdAt)?.getTime() || 0;
                const tB = this.toJsDate(b.lastMessage?.timestamp || b.updatedAt || b.createdAt)?.getTime() || 0;
                return tB - tA; // Recent on top
            });
            this.conversations.set(sorted);

            // Auto-update active conversation details if it changed
            if (this.activeConversation()) {
                const updated = sorted.find(c => c.id === this.activeConversation()!.id);
                if (updated) this.activeConversation.set(updated);
            }
            this.loading.set(false);
        });
    }

    private isGenericName(name?: string): boolean {
        if (!name) return true;
        const n = name.trim().toLowerCase();
        if (n === 'cliente ml' || n === 'cliente' || n === 'meli buyer' || n === 'cliente identificado') return true;
        if (name.length >= 6 && /^[A-Z0-9]{6,}$/.test(name)) return true;
        return false;
    }

    private loadOpenCount() {
        this.svc.getConversations('open', undefined, 200).subscribe(list => {
            this.openCount.set(list.length);
        });
    }

    openConversation(conv: Conversation) {
        this.activeConversation.set(conv);
        this.messagesLoading.set(true);
        this.msgSub?.unsubscribe();
        this.svc.markRead(conv.id).catch(() => {});
        this.msgSub = this.svc.getMessages(conv.id).subscribe(msgs => {
            const sorted = [...(msgs || [])].sort((a, b) => {
                const tA = this.toJsDate(a.timestamp)?.getTime() || Date.now();
                const tB = this.toJsDate(b.timestamp)?.getTime() || Date.now();
                return tA - tB; // Chronological order: oldest at top, newest at bottom
            });
            this.messages.set(sorted);
            this.messagesLoading.set(false);
            setTimeout(() => this.scrollToBottom(), 50);
        });

        // Load CRM Context
        this.loadCustomerContext(conv.customerId);
    }

    loadCustomerContext(customerId?: string) {
        this.profileSub?.unsubscribe();
        this.ordersSub?.unsubscribe();
        this.historySub?.unsubscribe();
        this.notesSub?.unsubscribe();
        this.customerProfile.set(null);
        this.customerOrders.set([]);
        this.customerHistory.set([]);
        this.customerNotes.set([]);
        this.meliStats.set(null);
        this.suggestedMatch.set(null);

        const conv = this.activeConversation();
        this.contextLoading.set(true);

        // Always load notes for the current conversation (regardless of customerId)
        if (conv?.id) {
            this.notesSub = this.svc.getConversationNotes(conv.id).subscribe(notes => {
                const sorted = [...(notes || [])].sort((a, b) => {
                    const tA = this.toJsDate(a.timestamp)?.getTime() || 0;
                    const tB = this.toJsDate(b.timestamp)?.getTime() || 0;
                    return tB - tA;
                });
                this.customerNotes.set(sorted);
            });
        }

        if (!customerId) {
            if (conv && conv.customerHandle) {
                this.svc.findSuggestedCustomerMatch(conv.customerHandle).then(match => {
                    if (match) {
                        this.suggestedMatch.set(match);
                    }
                }).catch(() => {});
            }
            return;
        }

        this.contextLoading.set(true);
        this.profileSub = this.svc.getCustomerProfile(customerId).subscribe(p => {
            this.customerProfile.set(p || null);
            this.contextLoading.set(false);
        });
        this.ordersSub = this.svc.getCustomerOrders(customerId).subscribe(o => {
            const sorted = [...(o || [])].sort((a, b) => {
                const tA = this.toJsDate(a.createdAt)?.getTime() || 0;
                const tB = this.toJsDate(b.createdAt)?.getTime() || 0;
                return tB - tA; // Recent on top
            });
            this.customerOrders.set(sorted);

            // Compute MeLi Stats
            const meliOrders = sorted.filter(item => {
                const sc = (item.sourceChannel || item.acquisitionChannel || '').toLowerCase();
                return sc === 'mercadolibre' || sc === 'meli';
            });
            const meliCount = meliOrders.length;
            const meliTotalSpend = meliOrders.reduce((sum, item) => sum + (item.total || 0), 0);
            this.meliStats.set({
                meliCount,
                meliTotalSpend,
                isRecurrent: meliCount > 0,
                totalOrders: sorted.length
            });
        });
        this.historySub = this.svc.getCustomerHistory(customerId).subscribe(history => {
            const otherTickets = (history || [])
                .filter(h => h.id !== this.activeConversation()?.id)
                .sort((a, b) => {
                    const tA = this.toJsDate(a.updatedAt || a.createdAt)?.getTime() || 0;
                    const tB = this.toJsDate(b.updatedAt || b.createdAt)?.getTime() || 0;
                    return tB - tA; // Recent on top
                });
            this.customerHistory.set(otherTickets);
        });
        this.notesSub = this.svc.getConversationNotes(conv?.id || '').subscribe(notes => {
            const sorted = [...(notes || [])].sort((a, b) => {
                const tA = this.toJsDate(a.timestamp)?.getTime() || 0;
                const tB = this.toJsDate(b.timestamp)?.getTime() || 0;
                return tB - tA; // Recent on top
            });
            this.customerNotes.set(sorted);
        });
    }

    async autoLinkSuggestedMatch() {
        const conv = this.activeConversation();
        const match = this.suggestedMatch();
        if (!conv || !match) return;

        await this.svc.linkCustomer(conv.id, match.customerId, match.displayName);

        // Optimistically update active conversation so thread header immediately shows real un-screened name
        this.activeConversation.update(c => c ? {
            ...c,
            customerId: match.customerId,
            customerName: match.displayName
        } : null);

        // Optimistically update in conversation list
        this.conversations.update(list => list.map(item => {
            if (item.id === conv.id) {
                return { ...item, customerId: match.customerId, customerName: match.displayName };
            }
            return item;
        }));

        this.suggestedMatch.set(null);
        this.loadCustomerContext(match.customerId);
    }

    isMeliOrder(order: any): boolean {
        const sc = (order?.sourceChannel || order?.acquisitionChannel || '').toLowerCase();
        return sc === 'mercadolibre' || sc === 'meli';
    }

    getOrderChannelLabel(order: any): string {
        if (this.isMeliOrder(order)) return 'MeLi';
        const sc = (order?.sourceChannel || order?.acquisitionChannel || '').toLowerCase();
        if (sc === 'storefront' || sc === 'web') return 'Web';
        if (sc === 'pos' || sc === 'tienda') return 'Mostrador';
        return order?.sourceChannel?.toUpperCase() || 'Web';
    }

    async linkCustomer() {
        const conv = this.activeConversation();
        if (!conv) return;
        
        const dialogRef = this.dialog.open(CustomerSearchModalComponent, {
            width: '500px',
            panelClass: 'dark-glass-dialog'
        });

        dialogRef.afterClosed().subscribe(async (customerId: string) => {
            if (customerId) {
                await this.svc.linkCustomer(conv.id, customerId);
                // The subscription to getConversations will update activeConversation
                // But we can trigger the load explicitly
                this.loadCustomerContext(customerId);
            }
        });
    }

    async unlinkCustomer() {
        const conv = this.activeConversation();
        if (!conv) return;
        if (confirm('¿Estás seguro de desvincular este cliente de la conversación?')) {
            // we link to null or empty
            await this.svc.linkCustomer(conv.id, '');
            this.loadCustomerContext('');
        }
    }

    // ── Customer 360 — Profile Edit ────────────────────────────────────────────

    toggleEditProfile() {
        if (!this.editingProfile()) {
            // Populate draft from current data
            this.profileDraft.name      = this.customerDisplayName() === 'Cliente' ? '' : this.customerDisplayName();
            this.profileDraft.email     = this.customerEmail();
            this.profileDraft.fullPhone = this.customerPhone();
            this.profileDraft.tags      = [...this.customerTagsList()];
        }
        this.editingProfile.update(v => !v);
    }

    toggleTag(value: string) {
        const idx = this.profileDraft.tags.indexOf(value);
        if (idx >= 0) {
            this.profileDraft.tags = this.profileDraft.tags.filter(t => t !== value);
        } else {
            this.profileDraft.tags = [...this.profileDraft.tags, value];
        }
    }

    async saveProfileDraft() {
        const conv = this.activeConversation();
        if (!conv || this.savingProfile()) return;

        this.savingProfile.set(true);
        try {
            await this.svc.updateConversationCustomerInfo(conv.id, {
                customerName:  this.profileDraft.name.trim() || undefined,
                customerEmail: this.profileDraft.email.trim() || undefined,
                customerPhone: this.profileDraft.fullPhone || undefined,
                customerTags:  this.profileDraft.tags,
            });

            // Sync to users profile if a real customerId exists
            if (conv.customerId) {
                await this.svc.updateUserProfile(conv.customerId, {
                    displayName: this.profileDraft.name.trim() || undefined,
                    email:       this.profileDraft.email.trim() || undefined,
                    phone:       this.profileDraft.fullPhone || undefined,
                    tags:        this.profileDraft.tags,
                }).catch(() => {}); // Ignore if user doc doesn't exist
            }

            // Optimistic update to activeConversation
            this.activeConversation.update(c => c ? {
                ...c,
                customerName:  this.profileDraft.name.trim() || c.customerName,
                customerPhone: this.profileDraft.fullPhone,
                customerEmail: this.profileDraft.email.trim(),
                customerTags:  this.profileDraft.tags,
            } as any : null);

            this.editingProfile.set(false);
        } catch (e) {
            console.error('[Inbox] Save profile failed:', e);
        } finally {
            this.savingProfile.set(false);
        }
    }

    async deleteNote(noteId: string) {
        const conv = this.activeConversation();
        if (!conv) return;
        if (!confirm('¿Eliminar esta nota?')) return;
        await this.svc.deleteConversationNote(conv.id, noteId);
    }

    copyPhone() {
        const phone = this.customerPhone();
        if (!phone) return;
        navigator.clipboard.writeText(phone).then(() => {
            // Brief visual feedback via temporary title change — no toast lib needed
            const btn = document.querySelector('.copy-btn') as HTMLElement;
            if (btn) {
                const orig = btn.textContent || '';
                btn.textContent = '✓ Copiado';
                setTimeout(() => btn.textContent = orig, 1500);
            }
        });
    }

    onNoteKeydown(event: Event) {
        const ke = event as KeyboardEvent;
        if (ke.ctrlKey && ke.key === 'Enter') {
            ke.preventDefault();
            this.sendInternalNote();
        }
    }

    getOrderProductSummary(order: any): string {
        const items: any[] = order.items || order.lineItems || order.products || [];
        if (!items.length) return '';
        const first = items[0]?.name || items[0]?.title || items[0]?.sku || '';
        return items.length > 1 ? `${first} +${items.length - 1} más` : first;
    }


    scrollToBottom() {
        const area = document.querySelector('.messages-area');
        if (area) area.scrollTop = area.scrollHeight;
    }


    async claimConversation() {
        const conv = this.activeConversation();
        const user = this.currentUser();
        if (!conv || !user) return;
        await this.svc.assign(conv.id, user.uid);
        // Optimistically update so the composer unlocks immediately, 
        // even if the conversation drops out of the current filter list (e.g. "Sin Asignar")
        this.activeConversation.update(c => c ? { ...c, assignedTo: user.uid } : null);
    }

    async transferConversation() {
        const conv = this.activeConversation();
        if (!conv) return;
        
        const dialogRef = this.dialog.open(AgentTransferModalComponent, {
            width: '500px',
            panelClass: 'dark-glass-dialog'
        });

        dialogRef.afterClosed().subscribe(async (result: { action: string, uid: string | null }) => {
            if (result) {
                await this.svc.assign(conv.id, result.uid); // null = unassigned pool
                this.activeConversation.set(null); // remove from my view
            }
        });
    }

    async sendReply() {
        const conv = this.activeConversation();
        const text = this.replyText.trim();
        const user = this.currentUser();
        if (!conv || !text || this.sending() || !user) return;

        this.sending.set(true);
        this.replyText = '';
        try {
            await this.svc.sendReply(conv.id, text);
        } catch (e) {
            console.error('[Inbox] Reply failed:', e);
            this.replyText = text; // restore on failure
        } finally {
            this.sending.set(false);
        }
    }

    async sendInternalNote() {
        const conv = this.activeConversation();
        const text = this.noteText.trim();
        const user = this.currentUser();
        if (!conv || !text || this.sendingNote() || !user) return;

        this.sendingNote.set(true);
        this.noteText = '';
        try {
            await this.svc.addConversationNote(
                conv.id, text,
                user.uid,
                user.displayName || user.email || 'Asesor'
            );
        } catch (e) {
            console.error('[Inbox] Internal note failed:', e);
            this.noteText = text;
        } finally {
            this.sendingNote.set(false);
        }
    }

    async resolve() {
        const conv = this.activeConversation();
        if (!conv) return;
        await this.svc.updateStatus(conv.id, 'resolved');
    }

    onEnter(event: Event) {
        const ke = event as KeyboardEvent;
        if (ke.shiftKey) return;
        ke.preventDefault();
        this.sendReply();
    }

    initials(name: string): string {
        return (name || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
    }

    private toJsDate(ts: any): Date | null {
        if (!ts) return null;
        if (typeof ts.toDate === 'function') return ts.toDate();
        if (ts instanceof Date) return ts;
        if (typeof ts === 'number') return new Date(ts);
        if (typeof ts === 'string') {
            const parsed = new Date(ts);
            return isNaN(parsed.getTime()) ? null : parsed;
        }
        if (typeof ts === 'object' && ts.seconds !== undefined) {
            return new Date(ts.seconds * 1000);
        }
        return null;
    }

    formatTime(ts: any): string {
        const d = this.toJsDate(ts);
        if (!d) return '';

        const now = new Date();
        const isToday = d.getDate() === now.getDate() &&
                        d.getMonth() === now.getMonth() &&
                        d.getFullYear() === now.getFullYear();

        const timeStr = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

        if (isToday) {
            return timeStr;
        }

        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        const isYesterday = d.getDate() === yesterday.getDate() &&
                            d.getMonth() === yesterday.getMonth() &&
                            d.getFullYear() === yesterday.getFullYear();

        if (isYesterday) {
            return `Ayer ${timeStr}`;
        }

        const isThisYear = d.getFullYear() === now.getFullYear();
        if (isThisYear) {
            const dateStr = d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
            return `${dateStr}, ${timeStr}`;
        }

        const fullDateStr = d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
        return `${fullDateStr}, ${timeStr}`;
    }

    formatFullDateTime(ts: any): string {
        const d = this.toJsDate(ts);
        if (!d) return '';
        return d.toLocaleString('es-MX', {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    statusLabel(s: string): string {
        const m: Record<string, string> = { open: 'Abierto', pending: 'Pendiente', resolved: 'Resuelto', snoozed: 'Pospuesto' };
        return m[s] ?? s;
    }
}
