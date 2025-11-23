import { Command, Message, WebsocketClientEventMessage } from "@project/common";
import { CommandHandler } from "./command-handler";
import { getWebSocketClient } from "@/services/web-socket-client-binding";

export default class WebsocketSendHandler implements CommandHandler {
    get sender() {
        return 'asbplayer-video';
    }

    get command() {
        return 'websocket-client-event';
    }

    handle( command: Command<Message>, sender: Browser.runtime.MessageSender, sendResponse: (response?: any) => void ): boolean {
        const wsClient = getWebSocketClient();
        const msg = command.message as WebsocketClientEventMessage;

        console.log(msg.body);

        if (wsClient?.socket?.readyState === WebSocket.OPEN) {
            wsClient.socket.send(JSON.stringify({command: "event", ...msg.body}));
        }

        return true;
    }
}
