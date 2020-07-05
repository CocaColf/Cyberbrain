// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { rpcClient } from "./rpc/rpc_client";
import { State } from './rpc/communication_pb';
import * as grpc from '@grpc/grpc-js';



// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "cyberbrain" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('cyberbrain.helloWorld', () => {
		// The code you place here will be executed every time your command is executed

		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from cyberbrain!');

		console.log("🐍");

		let state = new State();
		state.setStatus("client good");
		rpcClient.syncState(state, function (err, serverState) {
			if (err !== null) {
				switch (err.code) {
					case grpc.status.UNAVAILABLE:
						console.log(`Server unavailable: ${err.message}`);
						break;
					default:
						console.log(`Error calling syncState: ${err}`);
				}
			} else {
				console.log(serverState?.getStatus());
			}
		});
	});

	context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() {
}
