module.exports = {
    execute: async (message, args, client) => {
        const userId = message.from;
        const chat = await client.getChatById(message.to);
        let response = `Informações do usuário:\nID: ${userId}`;
        
        if (chat.isGroup) {
            const participant = chat.participants.find(p => p.id._serialized === userId);
            response += `\nStatus no grupo: ${participant.isAdmin ? 'Admin' : 'Membro'}`;
        }
        
        return response;
    }
};