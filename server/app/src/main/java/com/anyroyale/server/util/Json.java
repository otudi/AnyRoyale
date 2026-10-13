package com.anyroyale.server.util;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** Shared Jackson mapper and small helpers for reading untrusted client JSON. */
public final class Json {

  public static final ObjectMapper MAPPER =
      new ObjectMapper().configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

  private Json() {}

  public static ObjectNode obj() {
    return MAPPER.createObjectNode();
  }

  public static String write(Object value) {
    try {
      return MAPPER.writeValueAsString(value);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("Failed to serialise " + value.getClass(), e);
    }
  }

  /** Parses a client message; returns null for malformed JSON or non-object payloads. */
  public static JsonNode parseObject(String text) {
    try {
      JsonNode node = MAPPER.readTree(text);
      return node != null && node.isObject() ? node : null;
    } catch (JsonProcessingException e) {
      return null;
    }
  }

  public static String text(JsonNode node, String field, String fallback) {
    JsonNode v = node.get(field);
    return v != null && v.isTextual() ? v.asText() : fallback;
  }

  public static long longValue(JsonNode node, String field, long fallback) {
    JsonNode v = node.get(field);
    return v != null && v.canConvertToLong() ? v.asLong() : fallback;
  }

  public static int intValue(JsonNode node, String field, int fallback) {
    JsonNode v = node.get(field);
    return v != null && v.canConvertToInt() ? v.asInt() : fallback;
  }

  public static boolean bool(JsonNode node, String field, boolean fallback) {
    JsonNode v = node.get(field);
    return v != null && v.isBoolean() ? v.asBoolean() : fallback;
  }
}
