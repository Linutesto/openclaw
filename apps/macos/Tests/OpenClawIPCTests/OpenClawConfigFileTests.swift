import Foundation
import Testing
@testable import OpenPaw

@Suite(.serialized)
struct OpenClawConfigFileTests {
    @Test
    func configPathRespectsEnvOverride() async {
        let override = FileManager().temporaryDirectory
            .appendingPathComponent("openpaw-config-\(UUID().uuidString)")
            .appendingPathComponent("openpaw.json")
            .path

        await TestIsolation.withEnvValues(["OPENPAW_CONFIG_PATH": override]) {
            #expect(OpenClawConfigFile.url().path == override)
        }
    }

    @MainActor
    @Test
    func remoteGatewayPortParsesAndMatchesHost() async {
        let override = FileManager().temporaryDirectory
            .appendingPathComponent("openpaw-config-\(UUID().uuidString)")
            .appendingPathComponent("openpaw.json")
            .path

        await TestIsolation.withEnvValues(["OPENPAW_CONFIG_PATH": override]) {
            OpenClawConfigFile.saveDict([
                "gateway": [
                    "remote": [
                        "url": "ws://gateway.ts.net:19999",
                    ],
                ],
            ])
            #expect(OpenClawConfigFile.remoteGatewayPort() == 19999)
            #expect(OpenClawConfigFile.remoteGatewayPort(matchingHost: "gateway.ts.net") == 19999)
            #expect(OpenClawConfigFile.remoteGatewayPort(matchingHost: "gateway") == 19999)
            #expect(OpenClawConfigFile.remoteGatewayPort(matchingHost: "other.ts.net") == nil)
        }
    }

    @MainActor
    @Test
    func setRemoteGatewayUrlPreservesScheme() async {
        let override = FileManager().temporaryDirectory
            .appendingPathComponent("openpaw-config-\(UUID().uuidString)")
            .appendingPathComponent("openpaw.json")
            .path

        await TestIsolation.withEnvValues(["OPENPAW_CONFIG_PATH": override]) {
            OpenClawConfigFile.saveDict([
                "gateway": [
                    "remote": [
                        "url": "wss://old-host:111",
                    ],
                ],
            ])
            OpenClawConfigFile.setRemoteGatewayUrl(host: "new-host", port: 2222)
            let root = OpenClawConfigFile.loadDict()
            let url = ((root["gateway"] as? [String: Any])?["remote"] as? [String: Any])?["url"] as? String
            #expect(url == "wss://new-host:2222")
        }
    }

    @Test
    func stateDirOverrideSetsConfigPath() async {
        let dir = FileManager().temporaryDirectory
            .appendingPathComponent("openpaw-state-\(UUID().uuidString)", isDirectory: true)
            .path

        await TestIsolation.withEnvValues([
            "OPENPAW_CONFIG_PATH": nil,
            "OPENPAW_STATE_DIR": dir,
        ]) {
            #expect(OpenClawConfigFile.stateDirURL().path == dir)
            #expect(OpenClawConfigFile.url().path == "\(dir)/openpaw.json")
        }
    }
}
