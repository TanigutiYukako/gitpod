/**
 * Copyright (c) 2020 TypeFox GmbH. All rights reserved.
 * Licensed under the GNU Affero General Public License (AGPL).
 * See License-AGPL.txt in the project root for license information.
 */

import { injectable, inject } from 'inversify';
import { FrontendApplicationContribution, ApplicationShell } from '@theia/core/lib/browser';
import { TerminalFrontendContribution } from '@theia/terminal/lib/browser/terminal-frontend-contribution';
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import { GitpodTerminalWidget } from './gitpod-terminal-widget';

interface TaskStatus {
    alias: string
    name?: string
    open_in?: ApplicationShell.WidgetOptions['area']
    open_mode?: ApplicationShell.WidgetOptions['mode']
}

@injectable()
export class GitpodTaskContribution implements FrontendApplicationContribution {

    @inject(TerminalFrontendContribution)
    protected readonly terminals: TerminalFrontendContribution;

    async onDidInitializeLayout() {
        // TODO monitor task status and close terminal widget if an underlying terminal exits
        const response = await fetch(window.location.protocol + '//' + window.location.host + '/_supervisor/v1/status/tasks')
        const status: {
            tasks: TaskStatus[]
        } = await response.json();

        const terminalIdPrefix = 'gitpod-task:';
        const taskTerminals = new Map<string, GitpodTerminalWidget>();
        const otherTerminals = new Set<GitpodTerminalWidget>();
        for (const terminal of this.terminals.all) {
            if (terminal instanceof GitpodTerminalWidget) {
                if (terminal.id.startsWith(terminalIdPrefix)) {
                    taskTerminals.set(terminal.id, terminal);
                } else {
                    otherTerminals.add(terminal);
                }
            }
        }

        let ref: TerminalWidget | undefined;
        for (const task of status.tasks) {
            try {
                const id = terminalIdPrefix + task.alias;
                let terminal: TerminalWidget | undefined = taskTerminals.get(id)
                if (!terminal) {
                    // workspace (re)start
                    terminal = await this.terminals.newTerminal({
                        id,
                        title: task.name,
                        useServerTitle: false
                    });
                    await terminal.start();
                    await terminal.executeCommand({
                        cwd: '/workspace',
                        args: `/theia/supervisor terminal attach ${task.alias} -ir`.split(' ')
                    });
                    let widgetOptions: ApplicationShell.WidgetOptions = {}
                    const placeholder = otherTerminals.values().next().value as GitpodTerminalWidget | undefined;
                    if (placeholder) {
                        widgetOptions.ref = placeholder;
                    } else {
                        widgetOptions.ref = ref;
                        widgetOptions.area = task.open_in;
                        widgetOptions.mode = task.open_mode;
                    }
                    this.terminals.activateTerminal(terminal, widgetOptions);
                    if (placeholder) {
                        otherTerminals.delete(placeholder);
                        placeholder.dispose();
                    }
                } else {
                    // page reload
                    await terminal.start();
                    taskTerminals.delete(id);
                }
                ref = terminal;
            } catch (e) {
                console.error('Failed to start Gitpod task terminal:', e);
            }
        }
        for (const terminal of taskTerminals.values()) {
            terminal.dispose();
        }
        for (const terminal of otherTerminals) {
            terminal.start();
        }

        // if there is no terminal at all, lets start one
        if (!this.terminals.all.length) {
            const terminal = await this.terminals.newTerminal({});
            terminal.start();
            this.terminals.open(terminal);
        }
    }

}