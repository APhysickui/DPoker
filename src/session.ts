export interface Session {
    room: string;
    player: string;
    token: string;
}
export function validSession(value: unknown): value is Session {
    const s = value as Session | null;
    return !!s && typeof s === 'object' && /^[a-f0-9]{12}$/.test(s.room) &&
        typeof s.player === 'string' && /^[a-f0-9-]{36}$/.test(s.player) &&
        typeof s.token === 'string' && /^[a-f0-9-]{72}$/.test(s.token);
}
export function stored(room: string): Session | null {
    try {
        const value = JSON.parse(localStorage.getItem(`dpoker:${room}`) || 'null');
        return validSession(value) && value.room === room ? value : null;
    }
    catch {
        return null;
    }
}
export function download(name: string, data: unknown) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function readSeat(file: File): Promise<Session> {
    if (file.size > 4096)
        throw new Error('座位备份文件过大');
    const data = JSON.parse(await file.text());
    if (data.format !== 'dpoker.seat' || data.schemaVersion !== 1 || !validSession(data.session))
        throw new Error('请选择 DPoker 座位备份文件');
    return data.session;
}
