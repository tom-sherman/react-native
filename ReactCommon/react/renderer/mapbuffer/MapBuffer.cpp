/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "MapBuffer.h"

using namespace facebook::react;

namespace facebook {
namespace react {

// TODO T83483191: Extend MapBuffer C++ implementation to support basic random
// access
MapBuffer::MapBuffer(std::vector<uint8_t> data) : bytes_(std::move(data)) {
  auto header = reinterpret_cast<Header const *>(bytes_.data());
  count_ = header->count;

  if (header->bufferSize != bytes_.size()) {
    LOG(ERROR) << "Error: Data size does not match, expected "
               << header->bufferSize << " found: " << bytes_.size();
    abort();
  }
}

int32_t MapBuffer::getInt(Key key) const {
  int32_t value = 0;
  memcpy(
      reinterpret_cast<uint8_t *>(&value),
      bytes_.data() + getValueOffset(key),
      INT_SIZE);
  return value;
}

bool MapBuffer::getBool(Key key) const {
  return getInt(key) != 0;
}

double MapBuffer::getDouble(Key key) const {
  // TODO T83483191: extract this code into a "template method" and reuse it for
  // other types
  double value = 0;
  memcpy(
      reinterpret_cast<uint8_t *>(&value),
      bytes_.data() + getValueOffset(key),
      DOUBLE_SIZE);
  return value;
}

int32_t MapBuffer::getDynamicDataOffset() const {
  // The begininig of dynamic data can be calculated as the offset of the next
  // key in the map
  return getKeyOffset(count_);
}

std::string MapBuffer::getString(Key key) const {
  // TODO T83483191:Add checks to verify that offsets are under the boundaries
  // of the map buffer
  int32_t dynamicDataOffset = getDynamicDataOffset();
  int32_t stringLength = 0;
  int32_t offset = getInt(key);
  memcpy(
      reinterpret_cast<uint8_t *>(&stringLength),
      bytes_.data() + dynamicDataOffset + offset,
      INT_SIZE);

  char *value = new char[stringLength];

  memcpy(
      reinterpret_cast<char *>(value),
      bytes_.data() + dynamicDataOffset + offset + INT_SIZE,
      stringLength);

  return std::string(value, 0, stringLength);
}

MapBuffer MapBuffer::getMapBuffer(Key key) const {
  // TODO T83483191: Add checks to verify that offsets are under the boundaries
  // of the map buffer
  int32_t dynamicDataOffset = getDynamicDataOffset();

  int32_t mapBufferLength = 0;
  int32_t offset = getInt(key);
  memcpy(
      reinterpret_cast<uint8_t *>(&mapBufferLength),
      bytes_.data() + dynamicDataOffset + offset,
      INT_SIZE);

  std::vector<uint8_t> value(mapBufferLength);

  memcpy(
      value.data(),
      bytes_.data() + dynamicDataOffset + offset + INT_SIZE,
      mapBufferLength);

  return MapBuffer(std::move(value));
}

bool MapBuffer::isNull(Key key) const {
  return getInt(key) == NULL_VALUE;
}

uint32_t MapBuffer::size() const {
  return bytes_.size();
}

uint8_t const *MapBuffer::data() const {
  return bytes_.data();
}

uint16_t MapBuffer::count() const {
  return count_;
}

} // namespace react
} // namespace facebook
