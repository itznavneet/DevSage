import type { Request, Response } from "express";
export declare function createConversation(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function listConversations(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function getConversation(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function deleteConversation(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function createMessage(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
//# sourceMappingURL=conversation.controller.d.ts.map