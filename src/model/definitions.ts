export type TokenBreakdown = {
    total: number;
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
};

export type SessionHold = {
    id: string;
    agent: string;
    model: string;
    provider: string;
    cost: number;
    parentId?: string;
    role: 'primary' | 'subagent' | string;
    tokens?: TokenBreakdown;
    currentAgent?: string;
}
