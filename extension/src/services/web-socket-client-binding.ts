import { SettingsProvider, ankiSettingsKeys } from '@project/common/settings';
import {
    LoadSubtitlesCommand,
    MineSubtitleCommand,
    SeekTimestampCommand,
    WebSocketClient,
} from '@project/common/web-socket-client';
import TabRegistry from './tab-registry';
import {
    CurrentTimeToVideoMessage,
    CopySubtitleMessage,
    CopySubtitleWithAdditionalFieldsMessage,
    ExtensionToAsbPlayerCommand,
    ExtensionToVideoCommand,
    Message,
    PostMineAction,
    ToggleVideoSelectMessage,
    LoadSubtitlesWithResponseMessage,
} from '@project/common';

let client: WebSocketClient | undefined;

export const bindWebSocketClient = async (settings: SettingsProvider, tabRegistry: TabRegistry) => {
    client?.unbind();
    const url = await settings.getSingle('webSocketServerUrl');

    if (!url) {
        return;
    }

    client = new WebSocketClient();
    client.bind(url, true);
    client.onMineSubtitle = async ({
        body: { fields: receivedFields, postMineAction: receivedPostMineAction },
    }: MineSubtitleCommand) => {
        return new Promise((resolve, reject) => {
            browser.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
                const ankiSettings = await settings.get(ankiSettingsKeys);
                const fields = receivedFields ?? {};
                const word = fields[ankiSettings.wordField] || undefined;
                const definition = fields[ankiSettings.definitionField] || undefined;
                const text = fields[ankiSettings.sentenceField] || undefined;
                const customFieldValues = Object.fromEntries(
                    Object.entries(ankiSettings.customAnkiFields)
                        .map(([asbplayerFieldName, ankiFieldName]) => {
                            const fieldValue = fields[ankiFieldName];

                            if (fieldValue === undefined) {
                                return undefined;
                            }

                            return [asbplayerFieldName, fieldValue];
                        })
                        .filter((entry) => entry !== undefined) as string[][]
                );
                const postMineAction = receivedPostMineAction ?? PostMineAction.showAnkiDialog;
                let published = false;

                const publishToVideoElements = tabRegistry.publishCommandToVideoElements((videoElement) => {
                    if (!videoElement.loadedSubtitles) {
                        return undefined;
                    }

                    if (tabs.find((t) => t.id === videoElement.tab.id) === undefined) {
                        return undefined;
                    }

                    published = true;
                    const extensionToVideoCommand: ExtensionToVideoCommand<CopySubtitleMessage> = {
                        sender: 'asbplayer-extension-to-video',
                        message: {
                            command: 'copy-subtitle',
                            word,
                            definition,
                            text,
                            postMineAction,
                            customFieldValues,
                        },
                        src: videoElement.src,
                    };
                    return extensionToVideoCommand;
                });

                const publishToAsbplayers = await tabRegistry.publishCommandToAsbplayers({
                    commandFactory: (asbplayer) => {
                        if (asbplayer.sidePanel || !asbplayer.loadedSubtitles) {
                            return undefined;
                        }

                        published = true;
                        const extensionToPlayerCommand: ExtensionToAsbPlayerCommand<CopySubtitleWithAdditionalFieldsMessage> =
                            {
                                sender: 'asbplayer-extension-to-player',
                                message: {
                                    command: 'copy-subtitle-with-additional-fields',
                                    word,
                                    definition,
                                    text,
                                    postMineAction,
                                    customFieldValues,
                                },
                                asbplayerId: asbplayer.id,
                            };
                        return extensionToPlayerCommand;
                    },
                });

                await publishToVideoElements;
                await publishToAsbplayers;
                resolve(published);
            });
        });
    };
    client.onLoadSubtitles = async (command: LoadSubtitlesCommand) => {
        const { files: subtitleFiles, currentTabOnly = false, waitConfirmation = false } = command.body;

        console.log("LoadSubtitles command received. currentTabOnly: " + currentTabOnly + " waitConfirmation: " + waitConfirmation);

        const activeTabs = await browser.tabs.query({ active: true, currentWindow: true });
        const publishResult = await tabRegistry.publishCommandToVideoElements<LoadSubtitlesWithResponseMessage | ToggleVideoSelectMessage>(
            (videoElement) => {
                if (currentTabOnly && !activeTabs.find(t => t.id === videoElement.tab.id)) {
                    return undefined;
                }

                if (waitConfirmation) {
                    const loadCommand: ExtensionToVideoCommand<LoadSubtitlesWithResponseMessage> = {
                        sender: 'asbplayer-extension-to-video',
                        message: {
                            command: 'load-subtitles-with-response',
                            subtitleFiles,
                        },
                        src: videoElement.src,
                    };
                    return loadCommand;
                } else {
                    const toggleCommand: ExtensionToVideoCommand<ToggleVideoSelectMessage> = {
                        sender: 'asbplayer-extension-to-video',
                        message: {
                            command: 'toggle-video-select',
                            subtitleFiles,
                        },
                        src: videoElement.src,
                    };
                    return toggleCommand;
                }
            },
            { waitResponse: waitConfirmation }
        );

        if (!waitConfirmation) return true;
        return publishResult?.some(r => r.success === true) ?? false;
    };
    client.onSeekTimestamp = async ({ body: { timestamp } }: SeekTimestampCommand) => {
        return new Promise<void>((resolve) => {
            // Publish the command to all active video elements
            tabRegistry.publishCommandToVideoElements((videoElement) => {
                return {
                    sender: 'asbplayer-extension-to-video',
                    message: {
                        command: 'currentTime',
                        value: timestamp,
                    },
                    src: videoElement.src,
                };
            });

            resolve();
        });
    };
    client.onOffsetSubtitles = async ({ body: { value } }) => {
        return new Promise<void>((resolve) => {
            tabRegistry.publishCommandToVideoElements((videoElement) => {
                return {
                    sender: 'asbplayer-extension-to-video',
                    message: {
                        command: 'offset',
                        value
                    },
                    src: videoElement.src,
                };
            });

            resolve();
        });
    };
    client.onOffsetSubtitlesToCloseTimestamp = async ({ body: { direction } }) => {
        return new Promise<void>((resolve) => {
            tabRegistry.publishCommandToVideoElements((videoElement) => {
                const command =
                    direction === 'forward'
                        ? 'offset-subtitles-to-next-timestamp'
                        : 'offset-subtitles-to-previous-timestamp';

                return {
                    sender: 'asbplayer-extension-to-video',
                    message: { command },
                    src: videoElement.src,
                };
            });

            resolve();
        });
    };
};

export const unbindWebSocketClient = () => {
    client?.unbind();
};

export const getWebSocketClient = () => {
    return client;
}