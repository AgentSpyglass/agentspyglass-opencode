export type TokenBreakdown = {
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
    total: number;
    cost: number;
    parentId?: string;
    role: 'primary' | 'subagent' | string;
    tokens?: TokenBreakdown;
    modelRef?: {
        id: string;
        providerID: string;
        variant?: string;
    };
    currentAgent?: string;
}
