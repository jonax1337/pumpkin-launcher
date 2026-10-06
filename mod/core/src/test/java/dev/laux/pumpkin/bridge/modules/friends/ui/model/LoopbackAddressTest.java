package dev.laux.pumpkin.bridge.modules.friends.ui.model;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class LoopbackAddressTest {
	@ParameterizedTest(name = "{0} is literal loopback: {1}")
	@CsvSource({
		"127.0.0.1,true",
		"127.1.2.3,true",
		"127.255.255.255,true",
		"127.0.0.256,false",
		"128.0.0.1,false",
		"126.0.0.1,false",
		"10.0.0.1,false",
		"localhost,false",
		"0x7f.0.0.1,false",
		"127.1,false",
		"127.0.0.1.example.com,false",
		"example.com,false",
		"' 127.0.0.1',false",
		"::1,false",
		"'',false"})
	void acceptsOnlyADottedQuadInTheLoopbackBlock(String host, boolean expected) {
		assertEquals(expected, LoopbackAddress.isLiteral(host));
	}
}
