# Copyright (C) The Arvados Authors. All rights reserved.
#
# SPDX-License-Identifier: AGPL-3.0

require 'test_helper'
require 'rails/performance_test_help'

class IndexTest < ActionDispatch::PerformanceTest
  def test_links_index
    get '/arvados/v1/links', params: {format: :json}, headers: auth(:admin)
  end
  def test_links_index_with_filters
    get '/arvados/v1/links',
    params: {format: :json, filters: [%w[head_uuid is_a arvados#collection]].to_json},
    headers: auth(:admin)
  end
  def test_collections_index
    get '/arvados/v1/collections', params: {format: :json}, headers: auth(:admin)
  end
end
