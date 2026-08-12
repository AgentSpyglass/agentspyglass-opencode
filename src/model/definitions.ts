export type SessionHold = {
    id: string;
    agent: string;
    model: string;
    total: number;
    cost: number;
    parentId?: string;
    role: 'primary' | 'subagent' | string;
}
