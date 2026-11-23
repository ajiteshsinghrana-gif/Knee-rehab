/** One-tap contact links for a patient's phone number (physio feedback round). Nothing is sent by the app itself. */
const digits = (n: string) => n.replace(/[^\d+]/g, '');
export const telHref = (n: string): string => `tel:${digits(n)}`;
/** WhatsApp click-to-chat; wa.me wants the number without + or spaces. */
export const waHref = (n: string): string => `https://wa.me/${digits(n).replace(/^\+/, '')}`;
export const hasPhone = (n: string | undefined): n is string => !!n && digits(n).replace(/\D/g, '').length >= 6;
