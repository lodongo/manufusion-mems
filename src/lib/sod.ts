import { appPrompt } from '../components/dialogs';

/**
 * Sends a change; when the server answers that it would combine duties that must stay apart, explains the conflict,
 * asks for the business reason (audited) and sends it again with the acknowledgement. Cancelling saves nothing.
 */
export async function withSodAcknowledgement<T>(send: (extra: Record<string, unknown>) => Promise<T>): Promise<T> {
    try {
        return await send({});
    } catch (err) {
        const message = (err instanceof Error ? err.message : String(err ?? '')).replace(/^Error:\s*/, '');
        if (!message.startsWith('Segregation of duties')) throw err;
        const reason = await appPrompt(`${message}\n\nGive the business reason for combining these duties (10 to 300 characters). It is recorded in the audit trail.`);
        if (reason === null) throw new Error('Not saved. The duty conflict was not acknowledged.');
        return send({ acknowledgeSodAll: true, sodReason: reason.trim() });
    }
}
