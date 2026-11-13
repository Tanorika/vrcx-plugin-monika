/* Generated from VRCX 2026.09.16 (MIT). Run npm run build to regenerate. */
export function createVrcxAccountDatabase(sqliteService, accountId) {
  if(!/^usr_[a-zA-Z0-9-]+$/.test(accountId))throw new Error('无效账号 ID');
  const dbVars={userId:accountId,userPrefix:accountId.replaceAll('-','').replaceAll('_',''),maxTableSize:500,searchTableSize:5000};
  function parseBioLinks(value) {
    try {
        const links = JSON.parse(value);
        return Array.isArray(links) ? links : [];
    } catch {
        return [];
    }
}

function parseRow(dbRow) {
    return {
        userId: dbRow[0],
        bio: dbRow[1],
        bioLinks: parseBioLinks(dbRow[2]),
        updatedAt: dbRow[3]
    };
}

const userProfile = {
    async getUserProfile(userId) {
        let row = null;
        await sqliteService.execute(
            (dbRow) => {
                row = parseRow(dbRow);
            },
            `SELECT user_id, bio, bio_links, updated_at FROM ${dbVars.userPrefix}_user_profile WHERE user_id = @user_id`,
            {
                '@user_id': userId
            }
        );
        return row;
    },

    async getAllUserProfiles() {
        const data = [];
        await sqliteService.execute((dbRow) => {
            data.push(parseRow(dbRow));
        }, `SELECT user_id, bio, bio_links, updated_at FROM ${dbVars.userPrefix}_user_profile`);
        return data;
    },

    setUserProfile(profile) {
        sqliteService.executeNonQuery(
            `INSERT OR REPLACE INTO ${dbVars.userPrefix}_user_profile (user_id, bio, bio_links, updated_at) VALUES (@user_id, @bio, @bio_links, @updated_at)`,
            {
                '@user_id': profile.id,
                '@bio': profile.bio,
                '@bio_links': JSON.stringify(profile.bioLinks),
                '@updated_at': new Date().toJSON()
            }
        );
    },

    deleteUserProfile(userId) {
        sqliteService.executeNonQuery(`DELETE FROM ${dbVars.userPrefix}_user_profile WHERE user_id = @user_id`, {
            '@user_id': userId
        });
    }
};


const feed = {
    async addGPSToDatabase(entry) {
        const rowId = await sqliteService.executeInsert(
            `INSERT OR IGNORE INTO ${dbVars.userPrefix}_feed_gps (created_at, user_id, display_name, location, world_name, previous_location, time, group_name) VALUES (@created_at, @user_id, @display_name, @location, @world_name, @previous_location, @time, @group_name)`,
            {
                '@created_at': entry.created_at,
                '@user_id': entry.userId,
                '@display_name': entry.displayName,
                '@location': entry.location,
                '@world_name': entry.worldName,
                '@previous_location': entry.previousLocation,
                '@time': entry.time,
                '@group_name': entry.groupName
            }
        );
        return rowId ? { ...entry, rowId } : undefined;
    },

    async addStatusToDatabase(entry) {
        const rowId = await sqliteService.executeInsert(
            `INSERT OR IGNORE INTO ${dbVars.userPrefix}_feed_status (created_at, user_id, display_name, status, status_description, previous_status, previous_status_description) VALUES (@created_at, @user_id, @display_name, @status, @status_description, @previous_status, @previous_status_description)`,
            {
                '@created_at': entry.created_at,
                '@user_id': entry.userId,
                '@display_name': entry.displayName,
                '@status': entry.status,
                '@status_description': entry.statusDescription,
                '@previous_status': entry.previousStatus,
                '@previous_status_description': entry.previousStatusDescription
            }
        );
        return rowId ? { ...entry, rowId } : undefined;
    },

    async addBioToDatabase(entry) {
        const rowId = await sqliteService.executeInsert(
            `INSERT OR IGNORE INTO ${dbVars.userPrefix}_feed_bio (created_at, user_id, display_name, bio, previous_bio, bio_links, previous_bio_links) VALUES (@created_at, @user_id, @display_name, @bio, @previous_bio, @bio_links, @previous_bio_links)`,
            {
                '@created_at': entry.created_at,
                '@user_id': entry.userId,
                '@display_name': entry.displayName,
                '@bio': entry.bio,
                '@previous_bio': entry.previousBio,
                '@bio_links': JSON.stringify(entry.bioLinks ?? []),
                '@previous_bio_links': JSON.stringify(entry.previousBioLinks ?? [])
            }
        );
        return rowId ? { ...entry, rowId } : undefined;
    },

    async addAvatarToDatabase(entry) {
        const rowId = await sqliteService.executeInsert(
            `INSERT OR IGNORE INTO ${dbVars.userPrefix}_feed_avatar (created_at, user_id, display_name, owner_id, avatar_name, current_avatar_image_url, current_avatar_thumbnail_image_url, previous_current_avatar_image_url, previous_current_avatar_thumbnail_image_url) VALUES (@created_at, @user_id, @display_name, @owner_id, @avatar_name, @current_avatar_image_url, @current_avatar_thumbnail_image_url, @previous_current_avatar_image_url, @previous_current_avatar_thumbnail_image_url)`,
            {
                '@created_at': entry.created_at,
                '@user_id': entry.userId,
                '@display_name': entry.displayName,
                '@owner_id': entry.ownerId,
                '@avatar_name': entry.avatarName,
                '@current_avatar_image_url': entry.currentAvatarImageUrl,
                '@current_avatar_thumbnail_image_url': entry.currentAvatarThumbnailImageUrl,
                '@previous_current_avatar_image_url': entry.previousCurrentAvatarImageUrl,
                '@previous_current_avatar_thumbnail_image_url': entry.previousCurrentAvatarThumbnailImageUrl
            }
        );
        return rowId ? { ...entry, rowId } : undefined;
    },

    /**
     * Purges avatar feed data from the database.
     * !!!!
     *
     * @param {string | null} cutoffDate - ISO date string. Deletes records older than this date. If null, deletes all
     *   records.
     */
    async purgeAvatarFeedData(cutoffDate) {
        if (cutoffDate) {
            await sqliteService.executeNonQuery(
                `DELETE FROM ${dbVars.userPrefix}_feed_avatar WHERE created_at < @cutoff`,
                {
                    '@cutoff': cutoffDate
                }
            );
        } else {
            await sqliteService.executeNonQuery(`DELETE FROM ${dbVars.userPrefix}_feed_avatar`);
        }
    },

    async addOnlineOfflineToDatabase(entry) {
        const rowId = await sqliteService.executeInsert(
            `INSERT OR IGNORE INTO ${dbVars.userPrefix}_feed_online_offline (created_at, user_id, display_name, type, location, world_name, time, group_name) VALUES (@created_at, @user_id, @display_name, @type, @location, @world_name, @time, @group_name)`,
            {
                '@created_at': entry.created_at,
                '@user_id': entry.userId,
                '@display_name': entry.displayName,
                '@type': entry.type,
                '@location': entry.location,
                '@world_name': entry.worldName,
                '@time': entry.time,
                '@group_name': entry.groupName
            }
        );
        return rowId ? { ...entry, rowId } : undefined;
    },

    async searchFeedDatabase(
        search,
        filters,
        vipList,
        maxEntries = dbVars.searchTableSize,
        dateFrom = '',
        dateTo = ''
    ) {
        if (search.startsWith('wrld_') || search.startsWith('grp_')) {
            return this.getFeedByInstanceId(search, filters, vipList);
        }
        let vipQuery = '';
        const vipArgs = {};
        if (vipList.length > 0) {
            const vipPlaceholders = [];
            vipList.forEach((vip, i) => {
                const key = `@vip_${i}`;
                vipArgs[key] = vip;
                vipPlaceholders.push(key);
            });
            vipQuery = `AND user_id IN (${vipPlaceholders.join(', ')})`;
        }
        let dateQuery = '';
        if (dateFrom) {
            dateQuery += 'AND created_at >= @dateFrom ';
        }
        if (dateTo) {
            dateQuery += 'AND created_at <= @dateTo ';
        }
        let gps = true;
        let status = true;
        let bio = true;
        let avatar = true;
        let online = true;
        let offline = true;
        const aviPublic = search.includes('public');
        const aviPrivate = search.includes('private');
        if (filters.length > 0) {
            gps = false;
            status = false;
            bio = false;
            avatar = false;
            online = false;
            offline = false;
            filters.forEach((filter) => {
                switch (filter) {
                    case 'GPS':
                        gps = true;
                        break;
                    case 'Status':
                        status = true;
                        break;
                    case 'Bio':
                        bio = true;
                        break;
                    case 'Avatar':
                        avatar = true;
                        break;
                    case 'Online':
                        online = true;
                        break;
                    case 'Offline':
                        offline = true;
                        break;
                }
            });
        }
        const searchLike = `%${search}%`;
        const selects = [];
        const baseColumns = [
            'id',
            'created_at',
            'user_id',
            'display_name',
            'type',
            'location',
            'world_name',
            'previous_location',
            'time',
            'group_name',
            'status',
            'status_description',
            'previous_status',
            'previous_status_description',
            'bio',
            'previous_bio',
            'owner_id',
            'avatar_name',
            'current_avatar_image_url',
            'current_avatar_thumbnail_image_url',
            'previous_current_avatar_image_url',
            'previous_current_avatar_thumbnail_image_url',
            'bio_links',
            'previous_bio_links'
        ].join(', ');
        if (gps) {
            selects.push(
                `SELECT * FROM (SELECT id, created_at, user_id, display_name, 'GPS' AS type, location, world_name, previous_location, time, group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, NULL AS bio, NULL AS previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url, NULL AS bio_links, NULL AS previous_bio_links FROM ${dbVars.userPrefix}_feed_gps WHERE (display_name LIKE @searchLike OR world_name LIKE @searchLike OR group_name LIKE @searchLike) ${dateQuery} ${vipQuery} ORDER BY created_at DESC, id DESC LIMIT @perTable)`
            );
        }
        if (status) {
            selects.push(
                `SELECT * FROM (SELECT id, created_at, user_id, display_name, 'Status' AS type, NULL AS location, NULL AS world_name, NULL AS previous_location, NULL AS time, NULL AS group_name, status, status_description, previous_status, previous_status_description, NULL AS bio, NULL AS previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url, NULL AS bio_links, NULL AS previous_bio_links FROM ${dbVars.userPrefix}_feed_status WHERE (display_name LIKE @searchLike OR status LIKE @searchLike OR status_description LIKE @searchLike) ${dateQuery} ${vipQuery} ORDER BY created_at DESC, id DESC LIMIT @perTable)`
            );
        }
        if (bio) {
            selects.push(
                `SELECT * FROM (SELECT id, created_at, user_id, display_name, 'Bio' AS type, NULL AS location, NULL AS world_name, NULL AS previous_location, NULL AS time, NULL AS group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, bio, previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url, bio_links, previous_bio_links FROM ${dbVars.userPrefix}_feed_bio WHERE (display_name LIKE @searchLike OR bio LIKE @searchLike OR bio_links LIKE @searchLike) ${dateQuery} ${vipQuery} ORDER BY created_at DESC, id DESC LIMIT @perTable)`
            );
        }
        if (avatar) {
            let avatarQuery = '';
            if (aviPrivate) {
                avatarQuery = 'OR user_id = owner_id';
            } else if (aviPublic) {
                avatarQuery = 'OR user_id != owner_id';
            }
            selects.push(
                `SELECT * FROM (SELECT id, created_at, user_id, display_name, 'Avatar' AS type, NULL AS location, NULL AS world_name, NULL AS previous_location, NULL AS time, NULL AS group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, NULL AS bio, NULL AS previous_bio, owner_id, avatar_name, current_avatar_image_url, current_avatar_thumbnail_image_url, previous_current_avatar_image_url, previous_current_avatar_thumbnail_image_url, NULL AS bio_links, NULL AS previous_bio_links FROM ${dbVars.userPrefix}_feed_avatar WHERE (display_name LIKE @searchLike OR avatar_name LIKE @searchLike) ${avatarQuery} ${dateQuery} ${vipQuery} ORDER BY created_at DESC, id DESC LIMIT @perTable)`
            );
        }
        if (online || offline) {
            let query = '';
            if (!online || !offline) {
                if (online) {
                    query = "AND type = 'Online'";
                } else if (offline) {
                    query = "AND type = 'Offline'";
                }
            }
            selects.push(
                `SELECT * FROM (SELECT id, created_at, user_id, display_name, type, location, world_name, NULL AS previous_location, time, group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, NULL AS bio, NULL AS previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url, NULL AS bio_links, NULL AS previous_bio_links FROM ${dbVars.userPrefix}_feed_online_offline WHERE (display_name LIKE @searchLike OR world_name LIKE @searchLike OR group_name LIKE @searchLike) ${query} ${dateQuery} ${vipQuery} ORDER BY created_at DESC, id DESC LIMIT @perTable)`
            );
        }
        if (selects.length === 0) {
            return [];
        }
        const feedDatabase = [];
        const args = {
            '@searchLike': searchLike,
            '@limit': maxEntries,
            '@perTable': maxEntries,
            ...vipArgs
        };
        if (dateFrom) {
            args['@dateFrom'] = dateFrom;
        }
        if (dateTo) {
            args['@dateTo'] = dateTo;
        }
        await sqliteService.execute(
            (dbRow) => {
                const type = dbRow[4];
                const row = {
                    rowId: dbRow[0],
                    created_at: dbRow[1],
                    userId: dbRow[2],
                    displayName: dbRow[3],
                    type
                };
                switch (type) {
                    case 'GPS':
                        row.location = dbRow[5];
                        row.worldName = dbRow[6];
                        row.previousLocation = dbRow[7];
                        row.time = dbRow[8];
                        row.groupName = dbRow[9];
                        break;
                    case 'Status':
                        row.status = dbRow[10];
                        row.statusDescription = dbRow[11];
                        row.previousStatus = dbRow[12];
                        row.previousStatusDescription = dbRow[13];
                        break;
                    case 'Bio':
                        row.bio = dbRow[14];
                        row.previousBio = dbRow[15];
                        row.bioLinks = parseBioLinks(dbRow[22]);
                        row.previousBioLinks = parseBioLinks(dbRow[23]);
                        break;
                    case 'Avatar':
                        row.ownerId = dbRow[16];
                        row.avatarName = dbRow[17];
                        row.currentAvatarImageUrl = dbRow[18];
                        row.currentAvatarThumbnailImageUrl = dbRow[19];
                        row.previousCurrentAvatarImageUrl = dbRow[20];
                        row.previousCurrentAvatarThumbnailImageUrl = dbRow[21];
                        break;
                    case 'Online':
                    case 'Offline':
                        row.location = dbRow[5];
                        row.worldName = dbRow[6];
                        row.time = dbRow[8];
                        row.groupName = dbRow[9];
                        break;
                }
                feedDatabase.push(row);
            },
            `SELECT ${baseColumns} FROM (${selects.join(' UNION ALL ')}) ORDER BY created_at DESC, id DESC LIMIT @limit`,
            args
        );
        return feedDatabase;
    },

    async lookupFeedDatabase(filters, vipList, maxEntries = dbVars.maxTableSize) {
        let vipQuery = '';
        const vipArgs = {};
        if (vipList.length > 0) {
            const vipPlaceholders = [];
            vipList.forEach((vip, i) => {
                const key = `@vip_${i}`;
                vipArgs[key] = vip;
                vipPlaceholders.push(key);
            });
            vipQuery = `AND user_id IN (${vipPlaceholders.join(', ')})`;
        }
        let gps = true;
        let status = true;
        let bio = true;
        let avatar = true;
        let online = true;
        let offline = true;
        if (filters.length > 0) {
            gps = false;
            status = false;
            bio = false;
            avatar = false;
            online = false;
            offline = false;
            filters.forEach((filter) => {
                switch (filter) {
                    case 'GPS':
                        gps = true;
                        break;
                    case 'Status':
                        status = true;
                        break;
                    case 'Bio':
                        bio = true;
                        break;
                    case 'Avatar':
                        avatar = true;
                        break;
                    case 'Online':
                        online = true;
                        break;
                    case 'Offline':
                        offline = true;
                        break;
                }
            });
        }
        const selects = [];
        const baseColumns = [
            'id',
            'created_at',
            'user_id',
            'display_name',
            'type',
            'location',
            'world_name',
            'previous_location',
            'time',
            'group_name',
            'status',
            'status_description',
            'previous_status',
            'previous_status_description',
            'bio',
            'previous_bio',
            'owner_id',
            'avatar_name',
            'current_avatar_image_url',
            'current_avatar_thumbnail_image_url',
            'previous_current_avatar_image_url',
            'previous_current_avatar_thumbnail_image_url',
            'bio_links',
            'previous_bio_links'
        ].join(', ');
        if (gps) {
            selects.push(
                `SELECT * FROM (SELECT id, created_at, user_id, display_name, 'GPS' AS type, location, world_name, previous_location, time, group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, NULL AS bio, NULL AS previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url, NULL AS bio_links, NULL AS previous_bio_links FROM ${dbVars.userPrefix}_feed_gps WHERE 1=1 ${vipQuery} ORDER BY id DESC LIMIT @perTable)`
            );
        }
        if (status) {
            selects.push(
                `SELECT * FROM (SELECT id, created_at, user_id, display_name, 'Status' AS type, NULL AS location, NULL AS world_name, NULL AS previous_location, NULL AS time, NULL AS group_name, status, status_description, previous_status, previous_status_description, NULL AS bio, NULL AS previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url, NULL AS bio_links, NULL AS previous_bio_links FROM ${dbVars.userPrefix}_feed_status WHERE 1=1 ${vipQuery} ORDER BY id DESC LIMIT @perTable)`
            );
        }
        if (bio) {
            selects.push(
                `SELECT * FROM (SELECT id, created_at, user_id, display_name, 'Bio' AS type, NULL AS location, NULL AS world_name, NULL AS previous_location, NULL AS time, NULL AS group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, bio, previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url, bio_links, previous_bio_links FROM ${dbVars.userPrefix}_feed_bio WHERE 1=1 ${vipQuery} ORDER BY id DESC LIMIT @perTable)`
            );
        }
        if (avatar) {
            selects.push(
                `SELECT * FROM (SELECT id, created_at, user_id, display_name, 'Avatar' AS type, NULL AS location, NULL AS world_name, NULL AS previous_location, NULL AS time, NULL AS group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, NULL AS bio, NULL AS previous_bio, owner_id, avatar_name, current_avatar_image_url, current_avatar_thumbnail_image_url, previous_current_avatar_image_url, previous_current_avatar_thumbnail_image_url, NULL AS bio_links, NULL AS previous_bio_links FROM ${dbVars.userPrefix}_feed_avatar WHERE 1=1 ${vipQuery} ORDER BY id DESC LIMIT @perTable)`
            );
        }
        if (online || offline) {
            let query = '';
            if (!online || !offline) {
                if (online) {
                    query = "AND type = 'Online'";
                } else if (offline) {
                    query = "AND type = 'Offline'";
                }
            }
            selects.push(
                `SELECT * FROM (SELECT id, created_at, user_id, display_name, type, location, world_name, NULL AS previous_location, time, group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, NULL AS bio, NULL AS previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url, NULL AS bio_links, NULL AS previous_bio_links FROM ${dbVars.userPrefix}_feed_online_offline WHERE 1=1 ${query} ${vipQuery} ORDER BY id DESC LIMIT @perTable)`
            );
        }
        if (selects.length === 0) {
            return [];
        }
        const feedDatabase = [];
        const args = {
            '@limit': maxEntries,
            '@perTable': maxEntries,
            ...vipArgs
        };
        await sqliteService.execute(
            (dbRow) => {
                const type = dbRow[4];
                const row = {
                    rowId: dbRow[0],
                    created_at: dbRow[1],
                    userId: dbRow[2],
                    displayName: dbRow[3],
                    type
                };
                switch (type) {
                    case 'GPS':
                        row.location = dbRow[5];
                        row.worldName = dbRow[6];
                        row.previousLocation = dbRow[7];
                        row.time = dbRow[8];
                        row.groupName = dbRow[9];
                        break;
                    case 'Status':
                        row.status = dbRow[10];
                        row.statusDescription = dbRow[11];
                        row.previousStatus = dbRow[12];
                        row.previousStatusDescription = dbRow[13];
                        break;
                    case 'Bio':
                        row.bio = dbRow[14];
                        row.previousBio = dbRow[15];
                        row.bioLinks = parseBioLinks(dbRow[22]);
                        row.previousBioLinks = parseBioLinks(dbRow[23]);
                        break;
                    case 'Avatar':
                        row.ownerId = dbRow[16];
                        row.avatarName = dbRow[17];
                        row.currentAvatarImageUrl = dbRow[18];
                        row.currentAvatarThumbnailImageUrl = dbRow[19];
                        row.previousCurrentAvatarImageUrl = dbRow[20];
                        row.previousCurrentAvatarThumbnailImageUrl = dbRow[21];
                        break;
                    case 'Online':
                    case 'Offline':
                        row.location = dbRow[5];
                        row.worldName = dbRow[6];
                        row.time = dbRow[8];
                        row.groupName = dbRow[9];
                        break;
                }
                feedDatabase.push(row);
            },
            `SELECT ${baseColumns} FROM (${selects.join(' UNION ALL ')}) ORDER BY created_at DESC, id DESC LIMIT @limit`,
            args
        );
        return feedDatabase;
    },

    async getFeedByInstanceId(instanceId, filters, vipList) {
        let vipQuery = '';
        const vipArgs = {};
        if (vipList.length > 0) {
            const vipPlaceholders = [];
            vipList.forEach((vip, i) => {
                const key = `@vip_${i}`;
                vipArgs[key] = vip;
                vipPlaceholders.push(key);
            });
            vipQuery = `AND user_id IN (${vipPlaceholders.join(', ')})`;
        }
        let gps = true;
        let online = true;
        let offline = true;
        if (filters.length > 0) {
            gps = false;
            online = false;
            offline = false;
            filters.forEach((filter) => {
                switch (filter) {
                    case 'GPS':
                        gps = true;
                        break;
                    case 'Online':
                        online = true;
                        break;
                    case 'Offline':
                        offline = true;
                        break;
                }
            });
        }
        const selects = [];
        const baseColumns = [
            'id',
            'created_at',
            'user_id',
            'display_name',
            'type',
            'location',
            'world_name',
            'previous_location',
            'time',
            'group_name',
            'status',
            'status_description',
            'previous_status',
            'previous_status_description',
            'bio',
            'previous_bio',
            'owner_id',
            'avatar_name',
            'current_avatar_image_url',
            'current_avatar_thumbnail_image_url',
            'previous_current_avatar_image_url',
            'previous_current_avatar_thumbnail_image_url',
            'bio_links',
            'previous_bio_links'
        ].join(', ');
        if (gps) {
            selects.push(
                `SELECT * FROM (SELECT id, created_at, user_id, display_name, 'GPS' AS type, location, world_name, previous_location, time, group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, NULL AS bio, NULL AS previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url, NULL AS bio_links, NULL AS previous_bio_links FROM ${dbVars.userPrefix}_feed_gps WHERE location LIKE @instanceLike ${vipQuery} ORDER BY created_at DESC, id DESC LIMIT @perTable)`
            );
        }
        if (online || offline) {
            let query = '';
            if (!online || !offline) {
                if (online) {
                    query = "AND type = 'Online'";
                } else if (offline) {
                    query = "AND type = 'Offline'";
                }
            }
            selects.push(
                `SELECT * FROM (SELECT id, created_at, user_id, display_name, type, location, world_name, NULL AS previous_location, time, group_name, NULL AS status, NULL AS status_description, NULL AS previous_status, NULL AS previous_status_description, NULL AS bio, NULL AS previous_bio, NULL AS owner_id, NULL AS avatar_name, NULL AS current_avatar_image_url, NULL AS current_avatar_thumbnail_image_url, NULL AS previous_current_avatar_image_url, NULL AS previous_current_avatar_thumbnail_image_url, NULL AS bio_links, NULL AS previous_bio_links FROM ${dbVars.userPrefix}_feed_online_offline WHERE location LIKE @instanceLike ${query} ${vipQuery} ORDER BY created_at DESC, id DESC LIMIT @perTable)`
            );
        }
        if (selects.length === 0) {
            return [];
        }
        const feedDatabase = [];
        const args = {
            '@instanceLike': `%${instanceId}%`,
            '@limit': dbVars.searchTableSize,
            '@perTable': dbVars.searchTableSize,
            ...vipArgs
        };
        await sqliteService.execute(
            (dbRow) => {
                const type = dbRow[4];
                const row = {
                    rowId: dbRow[0],
                    created_at: dbRow[1],
                    userId: dbRow[2],
                    displayName: dbRow[3],
                    type
                };
                switch (type) {
                    case 'GPS':
                        row.location = dbRow[5];
                        row.worldName = dbRow[6];
                        row.previousLocation = dbRow[7];
                        row.time = dbRow[8];
                        row.groupName = dbRow[9];
                        break;
                    case 'Online':
                    case 'Offline':
                        row.location = dbRow[5];
                        row.worldName = dbRow[6];
                        row.time = dbRow[8];
                        row.groupName = dbRow[9];
                        break;
                }
                feedDatabase.push(row);
            },
            `SELECT ${baseColumns} FROM (${selects.join(' UNION ALL ')}) ORDER BY created_at DESC, id DESC LIMIT @limit`,
            args
        );
        return feedDatabase;
    },

    /**
     * @param {number} days - Number of days to look back
     * @param {number} limit - Max number of worlds to return
     * @returns {Promise<Array>} Ranked list of hot worlds
     */
    async getHotWorlds(days = 30, limit = 30) {
        const halfDays = Math.floor(days / 2);
        const results = [];
        await sqliteService.execute(
            (dbRow) => {
                results.push({
                    worldId: dbRow[0],
                    worldName: dbRow[1],
                    visitCount: dbRow[2],
                    uniqueFriends: dbRow[3],
                    lastVisited: dbRow[4]
                });
            },
            `SELECT
                SUBSTR(location, 1, INSTR(location, ':') - 1) AS world_id,
                world_name,
                COUNT(*) AS visit_count,
                COUNT(DISTINCT user_id) AS unique_friends,
                MAX(created_at) AS last_visited
            FROM ${dbVars.userPrefix}_feed_gps
            WHERE created_at >= datetime('now', @daysOffset)
                AND location LIKE 'wrld_%'
                AND INSTR(location, ':') > 0
                AND world_name IS NOT NULL AND world_name != ''
            GROUP BY world_id
            ORDER BY unique_friends DESC, visit_count DESC
            LIMIT @limit`,
            {
                '@daysOffset': `-${days} days`,
                '@limit': limit
            }
        );

        const trendMap = new Map();
        await sqliteService.execute(
            (dbRow) => {
                trendMap.set(dbRow[0], dbRow[1]);
            },
            `SELECT
                SUBSTR(location, 1, INSTR(location, ':') - 1) AS world_id,
                COUNT(DISTINCT user_id) AS unique_friends
            FROM ${dbVars.userPrefix}_feed_gps
            WHERE created_at >= datetime('now', @daysOffset)
                AND created_at < datetime('now', @halfOffset)
                AND location LIKE 'wrld_%'
                AND INSTR(location, ':') > 0
                AND world_name IS NOT NULL AND world_name != ''
            GROUP BY world_id`,
            {
                '@daysOffset': `-${days} days`,
                '@halfOffset': `-${halfDays} days`
            }
        );

        const recentMap = new Map();
        await sqliteService.execute(
            (dbRow) => {
                recentMap.set(dbRow[0], dbRow[1]);
            },
            `SELECT
                SUBSTR(location, 1, INSTR(location, ':') - 1) AS world_id,
                COUNT(DISTINCT user_id) AS unique_friends
            FROM ${dbVars.userPrefix}_feed_gps
            WHERE created_at >= datetime('now', @halfOffset)
                AND location LIKE 'wrld_%'
                AND INSTR(location, ':') > 0
                AND world_name IS NOT NULL AND world_name != ''
            GROUP BY world_id`,
            {
                '@halfOffset': `-${halfDays} days`
            }
        );

        for (const world of results) {
            const oldFriends = trendMap.get(world.worldId) || 0;
            const newFriends = recentMap.get(world.worldId) || 0;
            if (newFriends > oldFriends) {
                world.trend = 'rising';
            } else if (newFriends < oldFriends) {
                world.trend = 'cooling';
            } else {
                world.trend = 'stable';
            }
        }

        return results;
    },

    /**
     * @param {string} worldId - The world ID (e.g. wrld_xxx)
     * @param {number} days - Number of days to look back
     * @returns {Promise<Array>} List of friends who visited
     */
    async getHotWorldFriendDetail(worldId, days = 30) {
        const results = [];
        await sqliteService.execute(
            (dbRow) => {
                results.push({
                    userId: dbRow[0],
                    displayName: dbRow[1],
                    visitCount: dbRow[2],
                    lastVisit: dbRow[3]
                });
            },
            `SELECT
                user_id,
                display_name,
                COUNT(*) AS visit_count,
                MAX(created_at) AS last_visit
            FROM ${dbVars.userPrefix}_feed_gps
            WHERE SUBSTR(location, 1, INSTR(location, ':') - 1) = @worldId
                AND created_at >= datetime('now', @daysOffset)
            GROUP BY user_id
            ORDER BY visit_count DESC`,
            {
                '@worldId': worldId,
                '@daysOffset': `-${days} days`
            }
        );
        return results;
    }
};


const friendLogCurrent = {
    async getFriendLogCurrent() {
        var friendLogCurrent = [];
        await sqliteService.execute((dbRow) => {
            var row = {
                userId: dbRow[0],
                displayName: dbRow[1],
                trustLevel: dbRow[2],
                friendNumber: dbRow[3]
            };
            friendLogCurrent.unshift(row);
        }, `SELECT * FROM ${dbVars.userPrefix}_friend_log_current`);
        return friendLogCurrent;
    },

    setFriendLogCurrent(entry) {
        sqliteService.executeNonQuery(
            `INSERT OR REPLACE INTO ${dbVars.userPrefix}_friend_log_current (user_id, display_name, trust_level, friend_number) VALUES (@user_id, @display_name, @trust_level, @friend_number)`,
            {
                '@user_id': entry.userId,
                '@display_name': entry.displayName,
                '@trust_level': entry.trustLevel,
                '@friend_number': entry.friendNumber
            }
        );
    },

    setFriendLogCurrentArray(inputData) {
        if (inputData.length === 0) {
            return;
        }
        var sqlValues = '';
        var items = ['userId', 'displayName', 'trustLevel'];
        for (var line of inputData) {
            var field = {};
            for (var item of items) {
                if (typeof line[item] === 'string') {
                    field[item] = line[item].replace(/'/g, "''");
                } else {
                    field[item] = '';
                }
            }
            sqlValues += `('${field.userId}', '${field.displayName}', '${field.trustLevel}', ${line.friendNumber}), `;
        }
        sqlValues = sqlValues.slice(0, -2);
        sqliteService.executeNonQuery(
            `INSERT OR REPLACE INTO ${dbVars.userPrefix}_friend_log_current (user_id, display_name, trust_level, friend_number) VALUES ${sqlValues}`
        );
    },

    deleteFriendLogCurrent(userId) {
        sqliteService.executeNonQuery(`DELETE FROM ${dbVars.userPrefix}_friend_log_current WHERE user_id = @user_id`, {
            '@user_id': userId
        });
    }
};


const friendLogHistory = {
    async getFriendLogHistory() {
        var friendLogHistory = [];
        await sqliteService.execute((dbRow) => {
            var row = {
                rowId: dbRow[0],
                created_at: dbRow[1],
                type: dbRow[2],
                userId: dbRow[3],
                displayName: dbRow[4],
                friendNumber: dbRow[8]
            };
            if (row.type === 'DisplayName') {
                row.previousDisplayName = dbRow[5];
            } else if (row.type === 'TrustLevel') {
                row.trustLevel = dbRow[6];
                row.previousTrustLevel = dbRow[7];
            }
            friendLogHistory.unshift(row);
        }, `SELECT * FROM ${dbVars.userPrefix}_friend_log_history`);
        return friendLogHistory;
    },

    addFriendLogHistory(entry) {
        sqliteService.executeNonQuery(
            `INSERT OR IGNORE INTO ${dbVars.userPrefix}_friend_log_history (created_at, type, user_id, display_name, previous_display_name, trust_level, previous_trust_level, friend_number) VALUES (@created_at, @type, @user_id, @display_name, @previous_display_name, @trust_level, @previous_trust_level, @friend_number)`,
            {
                '@created_at': entry.created_at,
                '@type': entry.type,
                '@user_id': entry.userId,
                '@display_name': entry.displayName,
                '@previous_display_name': entry.previousDisplayName,
                '@trust_level': entry.trustLevel,
                '@previous_trust_level': entry.previousTrustLevel,
                '@friend_number': entry.friendNumber
            }
        );
    },

    addFriendLogHistoryArray(inputData) {
        if (inputData.length === 0) {
            return;
        }
        var sqlValues = '';
        var items = [
            'created_at',
            'type',
            'userId',
            'displayName',
            'previousDisplayName',
            'trustLevel',
            'previousTrustLevel',
            'friendNumber'
        ];
        for (var i = 0; i < inputData.length; ++i) {
            var line = inputData[i];
            sqlValues += '(';
            for (var k = 0; k < items.length; ++k) {
                var item = items[k];
                var field = '';
                if (typeof line[item] === 'string') {
                    field = `'${line[item].replace(/'/g, "''")}'`;
                } else {
                    field = null;
                }
                sqlValues += field;
                if (k < items.length - 1) {
                    sqlValues += ', ';
                }
            }
            sqlValues += ')';
            if (i < inputData.length - 1) {
                sqlValues += ', ';
            }
            // sqlValues `('${line.created_at}', '${line.type}', '${line.userId}', '${line.displayName}', '${line.previousDisplayName}', '${line.trustLevel}', '${line.previousTrustLevel}'), `
        }
        sqliteService.executeNonQuery(
            `INSERT OR IGNORE INTO ${dbVars.userPrefix}_friend_log_history (created_at, type, user_id, display_name, previous_display_name, trust_level, previous_trust_level, friend_number) VALUES ${sqlValues}`
        );
    },

    async getFriendLogHistoryForUserId(userId, types) {
        let friendLogHistory = [];
        let typeFilter = '';
        if (types && types.length > 0) {
            const escapedTypes = types.map((t) => `'${t.replace(/'/g, "''")}'`);
            typeFilter = ` AND type IN (${escapedTypes.join(', ')})`;
        }
        await sqliteService.execute(
            (dbRow) => {
                const row = {
                    rowId: dbRow[0],
                    created_at: dbRow[1],
                    type: dbRow[2],
                    userId: dbRow[3],
                    displayName: dbRow[4],
                    friendNumber: dbRow[8]
                };
                if (row.type === 'DisplayName') {
                    row.previousDisplayName = dbRow[5];
                } else if (row.type === 'TrustLevel') {
                    row.trustLevel = dbRow[6];
                    row.previousTrustLevel = dbRow[7];
                }
                friendLogHistory.push(row);
            },
            `SELECT * FROM ${dbVars.userPrefix}_friend_log_history WHERE user_id = @user_id${typeFilter}`,
            {
                '@user_id': userId
            }
        );
        return friendLogHistory;
    },

    // https://github.com/vrcx-team/VRCX/issues/1262
    deleteFriendLogHistory(entry) {
        if (entry.rowId != null) {
            sqliteService.executeNonQuery(`DELETE FROM ${dbVars.userPrefix}_friend_log_history WHERE id = @row_id`, {
                '@row_id': entry.rowId
            });
        } else {
            // Entries created in-session don't have a rowId yet;
            // fall back to composite key so the DB row is still removed.
            sqliteService.executeNonQuery(
                `DELETE FROM ${dbVars.userPrefix}_friend_log_history WHERE created_at = @created_at AND type = @type AND user_id = @user_id`,
                {
                    '@created_at': entry.created_at,
                    '@type': entry.type,
                    '@user_id': entry.userId
                }
            );
        }
    }
};


const notifications = {
    async getNotifications() {
        var notifications = [];
        await sqliteService.execute((dbRow) => {
            var row = {
                id: dbRow[0],
                created_at: dbRow[1],
                type: dbRow[2],
                senderUserId: dbRow[3],
                senderUsername: dbRow[4],
                receiverUserId: dbRow[5],
                message: dbRow[6],
                details: {
                    worldId: dbRow[7],
                    worldName: dbRow[8],
                    imageUrl: dbRow[9],
                    inviteMessage: dbRow[10],
                    requestMessage: dbRow[11],
                    responseMessage: dbRow[12]
                },
                $isExpired: dbRow[13] === 1
            };
            notifications.unshift(row);
        }, `SELECT * FROM ${dbVars.userPrefix}_notifications ORDER BY created_at DESC LIMIT ${dbVars.maxTableSize}`);
        return notifications;
    },

    async lookupNotificationDatabase(search, filters, vipList, maxEntries = dbVars.maxTableSize) {
        search = search.replaceAll("'", "''");
        let notifications = [];

        let vipQuery = '';
        if (vipList.length > 0) {
            const vipIds = vipList.map((userId) => `'${userId.replaceAll("'", "''")}'`);
            vipQuery = `AND sender_user_id IN (${vipIds.join(',')})`;
        }

        let filterQuery = '';
        if (filters.length > 0) {
            const filterTypes = filters.map((type) => `'${type.replaceAll("'", "''")}'`);
            filterQuery = `AND type IN (${filterTypes.join(',')})`;
        }

        await sqliteService.execute((dbRow) => {
            let row = {
                id: dbRow[0],
                created_at: dbRow[1],
                type: dbRow[2],
                senderUserId: dbRow[3],
                senderUsername: dbRow[4],
                receiverUserId: dbRow[5],
                message: dbRow[6],
                details: {
                    worldId: dbRow[7],
                    worldName: dbRow[8],
                    imageUrl: dbRow[9],
                    inviteMessage: dbRow[10],
                    requestMessage: dbRow[11],
                    responseMessage: dbRow[12]
                },
                $isExpired: dbRow[13] === 1
            };
            notifications.unshift(row);
        }, `SELECT * FROM ${dbVars.userPrefix}_notifications WHERE (sender_username LIKE '%${search}%' OR message LIKE '%${search}%' OR world_name LIKE '%${search}%') ${vipQuery} ${filterQuery} ORDER BY created_at DESC LIMIT ${maxEntries}`);
        return notifications;
    },

    addNotificationToDatabase(row) {
        var entry = {
            id: '',
            created_at: '',
            type: '',
            senderUserId: '',
            senderUsername: '',
            receiverUserId: '',
            message: '',
            ...row,
            details: {
                worldId: '',
                worldName: '',
                imageUrl: '',
                inviteMessage: '',
                requestMessage: '',
                responseMessage: '',
                ...row.details
            }
        };
        if (entry.imageUrl && !entry.details.imageUrl) {
            entry.details.imageUrl = entry.imageUrl;
        }
        var expired = 0;
        if (row.$isExpired) {
            expired = 1;
        }
        if (!entry.created_at || !entry.type || !entry.id) {
            console.error('Notification is missing required field', entry);
            throw new Error('Notification is missing required field');
        }
        sqliteService.executeNonQuery(
            `INSERT OR IGNORE INTO ${dbVars.userPrefix}_notifications (id, created_at, type, sender_user_id, sender_username, receiver_user_id, message, world_id, world_name, image_url, invite_message, request_message, response_message, expired) VALUES (@id, @created_at, @type, @sender_user_id, @sender_username, @receiver_user_id, @message, @world_id, @world_name, @image_url, @invite_message, @request_message, @response_message, @expired)`,
            {
                '@id': entry.id,
                '@created_at': entry.created_at,
                '@type': entry.type,
                '@sender_user_id': entry.senderUserId,
                '@sender_username': entry.senderUsername,
                '@receiver_user_id': entry.receiverUserId,
                '@message': entry.message,
                '@world_id': entry.details.worldId,
                '@world_name': entry.details.worldName,
                '@image_url': entry.details.imageUrl,
                '@invite_message': entry.details.inviteMessage,
                '@request_message': entry.details.requestMessage,
                '@response_message': entry.details.responseMessage,
                '@expired': expired
            }
        );
    },

    deleteNotification(rowId) {
        sqliteService.executeNonQuery(`DELETE FROM ${dbVars.userPrefix}_notifications WHERE id = @row_id`, {
            '@row_id': rowId
        });
    },

    updateNotificationExpired(entry) {
        var expired = 0;
        if (entry.$isExpired) {
            expired = 1;
        }
        sqliteService.executeNonQuery(
            `UPDATE ${dbVars.userPrefix}_notifications SET expired = @expired WHERE id = @id`,
            {
                '@id': entry.id,
                '@expired': expired
            }
        );
    },

    // notifications v2

    async getNotificationsV2() {
        const notifications = [];
        await sqliteService.execute((dbRow) => {
            const row = {
                id: dbRow[0],
                createdAt: dbRow[1],
                updatedAt: dbRow[2],
                expiresAt: dbRow[3],
                type: dbRow[4],
                link: dbRow[5],
                linkText: dbRow[6],
                message: dbRow[7],
                title: dbRow[8],
                imageUrl: dbRow[9],
                seen: dbRow[10] === 1,
                senderUserId: dbRow[11],
                senderUsername: dbRow[12],
                data: JSON.parse(dbRow[13] || '{}'),
                responses: JSON.parse(dbRow[14] || '[]'),
                details: JSON.parse(dbRow[15] || '{}')
            };
            // for UI table
            row.created_at = row.createdAt;
            row.version = 2;
            notifications.unshift(row);
        }, `SELECT * FROM ${dbVars.userPrefix}_notifications_v2 ORDER BY created_at DESC LIMIT ${dbVars.maxTableSize}`);
        return notifications;
    },

    addNotificationV2ToDatabase(entry) {
        sqliteService.executeNonQuery(
            `INSERT OR REPLACE INTO ${dbVars.userPrefix}_notifications_v2 (id, created_at, updated_at, expires_at, type, link, link_text, message, title, image_url, seen, sender_user_id, sender_username, data, responses, details) VALUES (@id, @created_at, @updated_at, @expires_at, @type, @link, @link_text, @message, @title, @image_url, @seen, @sender_user_id, @sender_username, @data, @responses, @details)`,
            {
                '@id': entry.id,
                '@created_at': entry.createdAt,
                '@updated_at': entry.updatedAt,
                '@expires_at': entry.expiresAt,
                '@type': entry.type,
                '@link': entry.link,
                '@link_text': entry.linkText,
                '@message': entry.message,
                '@title': entry.title,
                '@image_url': entry.imageUrl,
                '@seen': entry.seen ? 1 : 0,
                '@sender_user_id': entry.senderUserId,
                '@sender_username': entry.senderUsername,
                '@data': JSON.stringify(entry.data || {}),
                '@responses': JSON.stringify(entry.responses || []),
                '@details': JSON.stringify(entry.details || {})
            }
        );
    },

    expireNotificationV2(id) {
        sqliteService.executeNonQuery(
            `UPDATE ${dbVars.userPrefix}_notifications_v2 SET expires_at = @expires_at, seen = 1 WHERE id = @id`,
            {
                '@id': id,
                '@expires_at': new Date().toJSON()
            }
        );
    },

    seenNotificationV2(id) {
        sqliteService.executeNonQuery(`UPDATE ${dbVars.userPrefix}_notifications_v2 SET seen = 1 WHERE id = @id`, {
            '@id': id
        });
    },

    deleteNotificationV2(id) {
        sqliteService.executeNonQuery(`DELETE FROM ${dbVars.userPrefix}_notifications_v2 WHERE id = @id`, {
            '@id': id
        });
    }
};


const moderation = {
    async getModeration(userId) {
        var row = {};
        await sqliteService.execute(
            (dbRow) => {
                var block = false;
                var mute = false;
                if (dbRow[3] === 1) {
                    block = true;
                }
                if (dbRow[4] === 1) {
                    mute = true;
                }
                row = {
                    userId: dbRow[0],
                    updatedAt: dbRow[1],
                    displayName: dbRow[2],
                    block,
                    mute
                };
            },
            `SELECT * FROM ${dbVars.userPrefix}_moderation WHERE user_id = @userId`,
            {
                '@userId': userId
            }
        );
        return row;
    },

    setModeration(entry) {
        var block = 0;
        var mute = 0;
        if (entry.block) {
            block = 1;
        }
        if (entry.mute) {
            mute = 1;
        }
        sqliteService.executeNonQuery(
            `INSERT OR REPLACE INTO ${dbVars.userPrefix}_moderation (user_id, updated_at, display_name, block, mute) VALUES (@user_id, @updated_at, @display_name, @block, @mute)`,
            {
                '@user_id': entry.userId,
                '@updated_at': entry.updatedAt,
                '@display_name': entry.displayName,
                '@block': block,
                '@mute': mute
            }
        );
    },

    deleteModeration(userId) {
        sqliteService.executeNonQuery(`DELETE FROM ${dbVars.userPrefix}_moderation WHERE user_id = @user_id`, {
            '@user_id': userId
        });
    }
};


const ACTIVITY_VIEW_KIND = {
    ACTIVITY: 'activity',
    OVERLAP: 'overlap'
};

function syncStateTable() {
    return `${dbVars.userPrefix}_activity_sync_state_v2`;
}

function sessionsTable() {
    return `${dbVars.userPrefix}_activity_sessions_v2`;
}

function bucketCacheTable() {
    return `${dbVars.userPrefix}_activity_bucket_cache_v2`;
}

function parseJson(value, fallback) {
    if (!value) {
        return fallback;
    }
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

/**
 * Activity V2 is the formal, stable schema for the refactored Activity tab.
 * Legacy activity_cache_* tables remain only for upgrade compatibility.
 */
const activityV2 = {
    ACTIVITY_VIEW_KIND,

    async getActivitySourceSliceV2({ userId, isSelf, fromDays, toDays = 0 }) {
        const fromDateIso = new Date(Date.now() - fromDays * 86400000).toISOString();
        const toDateIso = toDays > 0 ? new Date(Date.now() - toDays * 86400000).toISOString() : '';
        return isSelf
            ? this.getCurrentUserLocationSliceV2(fromDateIso, toDateIso)
            : this.getFriendPresenceSliceV2(userId, fromDateIso, toDateIso);
    },

    async getActivitySourceAfterV2({ userId, isSelf, afterCreatedAt, inclusive = false }) {
        return isSelf
            ? this.getCurrentUserLocationAfterV2(afterCreatedAt, inclusive)
            : this.getFriendPresenceAfterV2(userId, afterCreatedAt);
    },

    async getFriendPresenceSliceV2(userId, fromDateIso, toDateIso = '') {
        const rows = [];
        await sqliteService.execute(
            (dbRow) => {
                rows.push({ created_at: dbRow[0], type: dbRow[1] });
            },
            `
                SELECT created_at, type
                FROM (
                    SELECT created_at, type, 0 AS sort_group
                    FROM (
                        SELECT created_at, type
                        FROM ${dbVars.userPrefix}_feed_online_offline
                        WHERE user_id = @userId
                          AND (type = 'Online' OR type = 'Offline')
                          AND created_at < @fromDateIso
                        ORDER BY created_at DESC
                        LIMIT 1
                    )
                    UNION ALL
                    SELECT created_at, type, 1 AS sort_group
                    FROM ${dbVars.userPrefix}_feed_online_offline
                    WHERE user_id = @userId
                      AND (type = 'Online' OR type = 'Offline')
                      AND created_at >= @fromDateIso
                      ${toDateIso ? 'AND created_at < @toDateIso' : ''}
                )
                ORDER BY created_at ASC, sort_group ASC
            `,
            {
                '@userId': userId,
                '@fromDateIso': fromDateIso,
                '@toDateIso': toDateIso
            }
        );

        if (toDateIso) {
            await sqliteService.execute(
                (dbRow) => {
                    rows.push({ created_at: dbRow[0], type: dbRow[1] });
                },
                `SELECT created_at, type
                 FROM ${dbVars.userPrefix}_feed_online_offline
                 WHERE user_id = @userId
                   AND (type = 'Online' OR type = 'Offline')
                   AND created_at >= @toDateIso
                 ORDER BY created_at ASC
                 LIMIT 1`,
                {
                    '@userId': userId,
                    '@toDateIso': toDateIso
                }
            );
        }

        return rows.sort((left, right) => left.created_at.localeCompare(right.created_at));
    },

    async getFriendPresenceAfterV2(userId, afterCreatedAt) {
        const rows = [];
        await sqliteService.execute(
            (dbRow) => {
                rows.push({ created_at: dbRow[0], type: dbRow[1] });
            },
            `SELECT created_at, type
             FROM ${dbVars.userPrefix}_feed_online_offline
             WHERE user_id = @userId
               AND (type = 'Online' OR type = 'Offline')
               AND created_at > @afterCreatedAt
             ORDER BY created_at`,
            {
                '@userId': userId,
                '@afterCreatedAt': afterCreatedAt
            }
        );
        return rows;
    },

    async getCurrentUserLocationSliceV2(fromDateIso, toDateIso = '') {
        const rows = [];
        await sqliteService.execute(
            (dbRow) => {
                rows.push({ created_at: dbRow[0], time: dbRow[1] || 0 });
            },
            `
                SELECT created_at, time
                FROM (
                    SELECT created_at, time, 0 AS sort_group
                    FROM (
                        SELECT created_at, time
                        FROM gamelog_location
                        WHERE created_at < @fromDateIso
                        ORDER BY created_at DESC
                        LIMIT 1
                    )
                    UNION ALL
                    SELECT created_at, time, 1 AS sort_group
                    FROM gamelog_location
                    WHERE created_at >= @fromDateIso
                      ${toDateIso ? 'AND created_at < @toDateIso' : ''}
                    ${
                        toDateIso
                            ? `UNION ALL
                    SELECT created_at, time, 2 AS sort_group
                    FROM (
                        SELECT created_at, time
                        FROM gamelog_location
                        WHERE created_at >= @toDateIso
                        ORDER BY created_at
                        LIMIT 1
                    )`
                            : ''
                    }
                )
                ORDER BY created_at ASC, sort_group ASC
            `,
            {
                '@fromDateIso': fromDateIso,
                '@toDateIso': toDateIso
            }
        );
        return rows;
    },

    async getCurrentUserLocationAfterV2(afterCreatedAt, inclusive = false) {
        const rows = [];
        const operator = inclusive ? '>=' : '>';
        await sqliteService.execute(
            (dbRow) => {
                rows.push({ created_at: dbRow[0], time: dbRow[1] || 0 });
            },
            `SELECT created_at, time
             FROM gamelog_location
             WHERE created_at ${operator} @afterCreatedAt
             ORDER BY created_at`,
            { '@afterCreatedAt': afterCreatedAt }
        );
        return rows;
    },

    async getActivitySyncStateV2(userId) {
        let row = null;
        await sqliteService.execute(
            (dbRow) => {
                row = {
                    userId: dbRow[0],
                    updatedAt: dbRow[1] || '',
                    isSelf: Boolean(dbRow[2]),
                    sourceLastCreatedAt: dbRow[3] || '',
                    pendingSessionStartAt: typeof dbRow[4] === 'number' ? dbRow[4] : null,
                    cachedRangeDays: dbRow[5] || 0
                };
            },
            `SELECT user_id, updated_at, is_self, source_last_created_at, pending_session_start_at, cached_range_days
             FROM ${syncStateTable()}
             WHERE user_id = @userId`,
            { '@userId': userId }
        );
        return row;
    },

    async upsertActivitySyncStateV2(entry) {
        await sqliteService.executeNonQuery(
            `INSERT OR REPLACE INTO ${syncStateTable()}
             (user_id, updated_at, is_self, source_last_created_at, pending_session_start_at, cached_range_days)
             VALUES (@userId, @updatedAt, @isSelf, @sourceLastCreatedAt, @pendingSessionStartAt, @cachedRangeDays)`,
            {
                '@userId': entry.userId,
                '@updatedAt': entry.updatedAt || '',
                '@isSelf': entry.isSelf ? 1 : 0,
                '@sourceLastCreatedAt': entry.sourceLastCreatedAt || '',
                '@pendingSessionStartAt': entry.pendingSessionStartAt,
                '@cachedRangeDays': entry.cachedRangeDays || 0
            }
        );
    },

    async getActivitySessionsV2(userId) {
        const sessions = [];
        await sqliteService.execute(
            (dbRow) => {
                sessions.push({
                    start: dbRow[0],
                    end: dbRow[1],
                    isOpenTail: Boolean(dbRow[2]),
                    sourceRevision: dbRow[3] || ''
                });
            },
            `SELECT start_at, end_at, is_open_tail, source_revision
             FROM ${sessionsTable()}
             WHERE user_id = @userId
             ORDER BY start_at`,
            { '@userId': userId }
        );
        return sessions;
    },

    async replaceActivitySessionsV2(userId, sessions = []) {
        await sqliteService.executeNonQuery('BEGIN');
        try {
            await sqliteService.executeNonQuery(`DELETE FROM ${sessionsTable()} WHERE user_id = @userId`, {
                '@userId': userId
            });
            await insertSessions(userId, sessions);
            await sqliteService.executeNonQuery('COMMIT');
        } catch (error) {
            await sqliteService.executeNonQuery('ROLLBACK');
            throw error;
        }
    },

    async appendActivitySessionsV2({ userId, sessions = [], replaceFromStartAt = null }) {
        await sqliteService.executeNonQuery('BEGIN');
        try {
            if (replaceFromStartAt !== null) {
                await sqliteService.executeNonQuery(
                    `DELETE FROM ${sessionsTable()}
                     WHERE user_id = @userId AND start_at >= @replaceFromStartAt`,
                    {
                        '@userId': userId,
                        '@replaceFromStartAt': replaceFromStartAt
                    }
                );
            }
            await insertSessions(userId, sessions);
            await sqliteService.executeNonQuery('COMMIT');
        } catch (error) {
            await sqliteService.executeNonQuery('ROLLBACK');
            throw error;
        }
    },

    async getActivityBucketCacheV2({ ownerUserId, targetUserId = '', rangeDays, viewKind, excludeKey = '' }) {
        let row = null;
        await sqliteService.execute(
            (dbRow) => {
                row = {
                    ownerUserId: dbRow[0],
                    targetUserId: dbRow[1],
                    rangeDays: dbRow[2],
                    viewKind: dbRow[3],
                    excludeKey: dbRow[4] || '',
                    bucketVersion: dbRow[5] || 1,
                    builtFromCursor: dbRow[6] || '',
                    rawBuckets: parseJson(dbRow[7], []),
                    normalizedBuckets: parseJson(dbRow[8], []),
                    summary: parseJson(dbRow[9], {}),
                    builtAt: dbRow[10] || ''
                };
            },
            `SELECT user_id, target_user_id, range_days, view_kind, exclude_key, bucket_version, built_from_cursor, raw_buckets_json, normalized_buckets_json, summary_json, built_at
             FROM ${bucketCacheTable()}
             WHERE user_id = @ownerUserId AND target_user_id = @targetUserId AND range_days = @rangeDays AND view_kind = @viewKind AND exclude_key = @excludeKey`,
            {
                '@ownerUserId': ownerUserId,
                '@targetUserId': targetUserId,
                '@rangeDays': rangeDays,
                '@viewKind': viewKind,
                '@excludeKey': excludeKey
            }
        );
        return row;
    },

    async upsertActivityBucketCacheV2(entry) {
        await sqliteService.executeNonQuery(
            `INSERT OR REPLACE INTO ${bucketCacheTable()}
             (user_id, target_user_id, range_days, view_kind, exclude_key, bucket_version, built_from_cursor, raw_buckets_json, normalized_buckets_json, summary_json, built_at)
             VALUES (@ownerUserId, @targetUserId, @rangeDays, @viewKind, @excludeKey, @bucketVersion, @builtFromCursor, @rawBucketsJson, @normalizedBucketsJson, @summaryJson, @builtAt)`,
            {
                '@ownerUserId': entry.ownerUserId,
                '@targetUserId': entry.targetUserId || '',
                '@rangeDays': entry.rangeDays,
                '@viewKind': entry.viewKind,
                '@excludeKey': entry.excludeKey || '',
                '@bucketVersion': entry.bucketVersion || 1,
                '@builtFromCursor': entry.builtFromCursor || '',
                '@rawBucketsJson': JSON.stringify(entry.rawBuckets || []),
                '@normalizedBucketsJson': JSON.stringify(entry.normalizedBuckets || []),
                '@summaryJson': JSON.stringify(entry.summary || {}),
                '@builtAt': entry.builtAt || ''
            }
        );
    }
};

async function insertSessions(userId, sessions = []) {
    if (sessions.length === 0) {
        return;
    }

    const chunkSize = 250;
    for (let chunkStart = 0; chunkStart < sessions.length; chunkStart += chunkSize) {
        const chunk = sessions.slice(chunkStart, chunkStart + chunkSize);
        const args = {};
        const values = chunk.map((session, index) => {
            const suffix = `${chunkStart + index}`;
            args[`@userId_${suffix}`] = userId;
            args[`@startAt_${suffix}`] = session.start;
            args[`@endAt_${suffix}`] = session.end;
            args[`@isOpenTail_${suffix}`] = session.isOpenTail ? 1 : 0;
            args[`@sourceRevision_${suffix}`] = session.sourceRevision || '';
            return `(@userId_${suffix}, @startAt_${suffix}, @endAt_${suffix}, @isOpenTail_${suffix}, @sourceRevision_${suffix})`;
        });

        await sqliteService.executeNonQuery(
            `INSERT OR REPLACE INTO ${sessionsTable()}
             (user_id, start_at, end_at, is_open_tail, source_revision)
             VALUES ${values.join(', ')}`,
            args
        );
    }
}


  const database={    async initUserTables(userId) {
        dbVars.userId = userId;
        dbVars.userPrefix = userId.replaceAll('-', '').replaceAll('_', '');
        // Fix escape, add underscore if prefix starts with a number
        if (dbVars.userPrefix.match(/^\d/)) {
            dbVars.userPrefix = '_' + dbVars.userPrefix;
        }
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_feed_gps (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, display_name TEXT, location TEXT, world_name TEXT, previous_location TEXT, time INTEGER, group_name TEXT)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_feed_status (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, display_name TEXT, status TEXT, status_description TEXT, previous_status TEXT, previous_status_description TEXT)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_feed_bio (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, display_name TEXT, bio TEXT, previous_bio TEXT, bio_links TEXT, previous_bio_links TEXT)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_feed_avatar (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, display_name TEXT, owner_id TEXT, avatar_name TEXT, current_avatar_image_url TEXT, current_avatar_thumbnail_image_url TEXT, previous_current_avatar_image_url TEXT, previous_current_avatar_thumbnail_image_url TEXT)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_feed_online_offline (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, display_name TEXT, type TEXT, location TEXT, world_name TEXT, time INTEGER, group_name TEXT)`
        );
        await sqliteService.executeNonQuery(
            `CREATE INDEX IF NOT EXISTS ${dbVars.userPrefix}_feed_online_offline_user_created_idx ON ${dbVars.userPrefix}_feed_online_offline (user_id, created_at)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_activity_sync_state_v2 (
                user_id TEXT PRIMARY KEY,
                updated_at TEXT NOT NULL DEFAULT '',
                is_self INTEGER NOT NULL DEFAULT 0,
                source_last_created_at TEXT NOT NULL DEFAULT '',
                pending_session_start_at INTEGER,
                cached_range_days INTEGER NOT NULL DEFAULT 0
            )`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_activity_sessions_v2 (
                session_id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                start_at INTEGER NOT NULL,
                end_at INTEGER NOT NULL,
                is_open_tail INTEGER NOT NULL DEFAULT 0,
                source_revision TEXT NOT NULL DEFAULT ''
            )`
        );
        await sqliteService.executeNonQuery(
            `CREATE INDEX IF NOT EXISTS ${dbVars.userPrefix}_activity_sessions_v2_user_start_idx ON ${dbVars.userPrefix}_activity_sessions_v2 (user_id, start_at)`
        );
        await sqliteService.executeNonQuery(
            `CREATE INDEX IF NOT EXISTS ${dbVars.userPrefix}_activity_sessions_v2_user_end_idx ON ${dbVars.userPrefix}_activity_sessions_v2 (user_id, end_at)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_activity_bucket_cache_v2 (
                user_id TEXT NOT NULL,
                target_user_id TEXT NOT NULL DEFAULT '',
                range_days INTEGER NOT NULL,
                view_kind TEXT NOT NULL,
                exclude_key TEXT NOT NULL DEFAULT '',
                bucket_version INTEGER NOT NULL DEFAULT 1,
                raw_buckets_json TEXT NOT NULL DEFAULT '[]',
                normalized_buckets_json TEXT NOT NULL DEFAULT '[]',
                built_from_cursor TEXT NOT NULL DEFAULT '',
                summary_json TEXT NOT NULL DEFAULT '{}',
                built_at TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (user_id, target_user_id, range_days, view_kind, exclude_key)
            )`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_friend_log_current (user_id TEXT PRIMARY KEY, display_name TEXT, trust_level TEXT, friend_number INTEGER)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_friend_log_history (id INTEGER PRIMARY KEY, created_at TEXT, type TEXT, user_id TEXT, display_name TEXT, previous_display_name TEXT, trust_level TEXT, previous_trust_level TEXT, friend_number INTEGER)`
        );
        await sqliteService.executeNonQuery(
            `CREATE INDEX IF NOT EXISTS ${dbVars.userPrefix}_friend_log_history_user_id_idx ON ${dbVars.userPrefix}_friend_log_history (user_id)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_notifications (id TEXT PRIMARY KEY, created_at TEXT, type TEXT, sender_user_id TEXT, sender_username TEXT, receiver_user_id TEXT, message TEXT, world_id TEXT, world_name TEXT, image_url TEXT, invite_message TEXT, request_message TEXT, response_message TEXT, expired INTEGER)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_notifications_v2 (id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, expires_at TEXT, type TEXT, link TEXT, link_text TEXT, message TEXT, title TEXT, image_url TEXT, seen INTEGER, sender_user_id TEXT, sender_username TEXT, data TEXT, responses TEXT, details TEXT)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_moderation (user_id TEXT PRIMARY KEY, updated_at TEXT, display_name TEXT, block INTEGER, mute INTEGER)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_avatar_history (avatar_id TEXT PRIMARY KEY, created_at TEXT, time INTEGER)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_notes (user_id TEXT PRIMARY KEY, display_name TEXT, note TEXT, created_at TEXT)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_mutual_graph_friends (friend_id TEXT PRIMARY KEY)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_mutual_graph_links (friend_id TEXT NOT NULL, mutual_id TEXT NOT NULL, PRIMARY KEY(friend_id, mutual_id))`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_mutual_graph_meta (friend_id TEXT PRIMARY KEY, last_fetched_at TEXT, opted_out INTEGER DEFAULT 0)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_user_profile (user_id TEXT PRIMARY KEY, bio TEXT, bio_links TEXT, updated_at TEXT)`
        );
    },

 ...userProfile,...feed,...friendLogCurrent,...friendLogHistory,...notifications,...moderation,...activityV2};
  return database;
}
export function createVrcxCloudContext(database, metadata) {
  const noop=()=>{}; const AppDebug={debugFriendState:false};
  const friends=new Map(),cachedUsers=new Map();
  const friendStore={friends,localFavoriteFriends:new Map(),updateOnlineFriendCounter:noop,reindexSortedFriend:noop};
  const userStore={currentUser:{id:metadata.accountId},state:{instancePlayerCount:new Map()},userDialog:{$location:{tag:''}},applyUserDialogLocation:noop,checkNote:noop,cachedUsers};
  const useFriendStore=()=>friendStore,useUserStore=()=>userStore,useWorldStore=()=>({worldDialog:{id:''}}),useGroupStore=()=>({groupDialog:{id:''}}),useInstanceStore=()=>({applyWorldDialogInstances:noop,applyGroupDialogInstances:noop});
  const useFeedStore=()=>({addFeedEntry:noop}),useNotificationStore=()=>({queueFeedNoty:noop}),useSharedFeedStore=()=>({addEntry:noop});
  const syncFriendSearchIndex=noop;
  const parseLocation=value=>({tag:value || '',worldId:typeof value==='string'?value.split(':')[0]:'',groupId:''});
  const getWorldName=async location=>metadata.worldName(location),getGroupName=async()=>'',getAvatarName=async image=>metadata.avatarName?.(image) || {ownerId:'',avatarName:''};
  /**
 * Handles user diff events and applies cross-store side effects.
 *
 * @param {object} ref Updated user reference.
 * @param {object} props Changed props with [new, old] tuples.
 * @param {object} [options] Test seams.
 * @param {function} [options.now] Timestamp provider.
 * @param {function} [options.nowIso] ISO timestamp provider.
 * @returns {Promise<void>}
 */
async function runHandleUserUpdateFlow(ref, props, { now = Date.now, nowIso = () => new Date().toJSON() } = {}) {
    const friendStore = useFriendStore();
    const userStore = useUserStore();
    const worldStore = useWorldStore();
    const groupStore = useGroupStore();
    const instanceStore = useInstanceStore();
    const feedStore = useFeedStore();
    const notificationStore = useNotificationStore();
    const sharedFeedStore = useSharedFeedStore();

    const { state, userDialog, applyUserDialogLocation, checkNote } = userStore;

    let feed;
    let newLocation;
    let previousLocation;
    const friend = friendStore.friends.get(ref.id);
    if (typeof friend === 'undefined') {
        return;
    }
    if (props.location) {
        // update instancePlayerCount
        previousLocation = props.location[1];
        newLocation = props.location[0];
        let oldCount = state.instancePlayerCount.get(previousLocation);
        if (typeof oldCount !== 'undefined') {
            oldCount--;
            if (oldCount <= 0) {
                state.instancePlayerCount.delete(previousLocation);
            } else {
                state.instancePlayerCount.set(previousLocation, oldCount);
            }
        }
        let newCount = state.instancePlayerCount.get(newLocation);
        if (typeof newCount === 'undefined') {
            newCount = 0;
        }
        newCount++;
        state.instancePlayerCount.set(newLocation, newCount);

        const previousLocationL = parseLocation(previousLocation);
        const newLocationL = parseLocation(newLocation);
        if (previousLocationL.tag === userDialog.$location.tag || newLocationL.tag === userDialog.$location.tag) {
            // update user dialog instance occupants
            applyUserDialogLocation(true);
        }
        if (
            previousLocationL.worldId === worldStore.worldDialog.id ||
            newLocationL.worldId === worldStore.worldDialog.id
        ) {
            instanceStore.applyWorldDialogInstances();
        }
        if (
            previousLocationL.groupId === groupStore.groupDialog.id ||
            newLocationL.groupId === groupStore.groupDialog.id
        ) {
            instanceStore.applyGroupDialogInstances();
        }
    }
    if (
        !props.state &&
        props.location &&
        props.location[0] !== 'offline' &&
        props.location[0] !== '' &&
        props.location[1] !== 'offline' &&
        props.location[1] !== '' &&
        props.location[0] !== 'traveling'
    ) {
        // skip GPS if user is offline or traveling
        previousLocation = props.location[1];
        newLocation = props.location[0];
        let time = props.location[2];
        if (previousLocation === 'traveling' && ref.$previousLocation) {
            previousLocation = ref.$previousLocation;
            const travelTime = now() - ref.$travelingToTime;
            time -= travelTime;
            if (time < 0) {
                time = 0;
            }
        }
        if (AppDebug.debugFriendState && previousLocation) {
            console.log(`${ref.displayName} GPS ${previousLocation} -> ${newLocation}`);
        }
        if (previousLocation === 'offline') {
            previousLocation = '';
        }
        if (!previousLocation) {
            // no previous location
            if (AppDebug.debugFriendState) {
                console.log(ref.displayName, 'Ignoring GPS, no previous location', newLocation);
            }
        } else if (ref.$previousLocation === newLocation) {
            // location traveled to is the same
            ref.$location_at = now() - time;
        } else {
            const worldName = await getWorldName(newLocation);
            const groupName = await getGroupName(newLocation);
            feed = {
                created_at: nowIso(),
                type: 'GPS',
                userId: ref.id,
                displayName: ref.displayName,
                location: newLocation,
                worldName,
                groupName,
                previousLocation,
                time
            };
            notificationStore.queueFeedNoty(feed);
            sharedFeedStore.addEntry(feed);
            const persistedFeed = await database.addGPSToDatabase(feed);
            if (persistedFeed) {
                feedStore.addFeedEntry(persistedFeed);
            }
            // clear previousLocation after GPS
            ref.$previousLocation = '';
            ref.$travelingToTime = now();
        }
    }
    if (props.location && props.location[0] === 'traveling' && props.location[1] !== 'traveling') {
        // store previous location when user is traveling
        ref.$previousLocation = props.location[1];
        ref.$travelingToTime = now();
    }
    if (ref.bannerType === 'avatarBanner' && props.bannerUrl && props.bannerUrl[0]) {
        const currentBannerUrl = props.bannerUrl[0];
        const previousBannerUrl = props.bannerUrl[1];
        let avatarInfo = {
            ownerId: '',
            avatarName: ''
        };
        try {
            avatarInfo = await getAvatarName(currentBannerUrl);
        } catch (err) {
            console.log(err);
        }
        if (avatarInfo.ownerId) {
            let previousAvatarInfo = {
                ownerId: '',
                avatarName: ''
            };
            try {
                previousAvatarInfo = await getAvatarName(previousBannerUrl);
            } catch (err) {
                console.log(err);
            }
            feed = {
                created_at: nowIso(),
                type: 'Avatar',
                userId: ref.id,
                displayName: ref.displayName,
                ownerId: avatarInfo.ownerId,
                previousOwnerId: previousAvatarInfo.ownerId,
                avatarName: avatarInfo.avatarName,
                previousAvatarName: previousAvatarInfo.avatarName,
                currentAvatarImageUrl: avatarInfo.ownerId ? currentBannerUrl : '',
                currentAvatarThumbnailImageUrl: avatarInfo.ownerId ? currentBannerUrl : '',
                previousCurrentAvatarImageUrl: previousAvatarInfo.ownerId ? previousBannerUrl : '',
                previousCurrentAvatarThumbnailImageUrl: previousAvatarInfo.ownerId ? previousBannerUrl : ''
            };
            notificationStore.queueFeedNoty(feed);
            sharedFeedStore.addEntry(feed);
            const persistedFeed = await database.addAvatarToDatabase(feed);
            if (persistedFeed) {
                feedStore.addFeedEntry(persistedFeed);
            }
        }
    } else if (props.iconUrl && props.iconUrl[0]) {
        const currentIconUrl = props.iconUrl[0];
        const previousIconUrl = props.iconUrl[1];
        let avatarInfo = {
            ownerId: '',
            avatarName: ''
        };
        try {
            avatarInfo = await getAvatarName(currentIconUrl);
        } catch (err) {
            console.log(err);
        }
        if (avatarInfo.ownerId) {
            let previousAvatarInfo = {
                ownerId: '',
                avatarName: ''
            };
            try {
                previousAvatarInfo = await getAvatarName(previousIconUrl);
            } catch (err) {
                console.log(err);
            }
            feed = {
                created_at: nowIso(),
                type: 'Avatar',
                userId: ref.id,
                displayName: ref.displayName,
                ownerId: avatarInfo.ownerId,
                previousOwnerId: previousAvatarInfo.ownerId,
                avatarName: avatarInfo.avatarName,
                previousAvatarName: previousAvatarInfo.avatarName,
                currentAvatarImageUrl: avatarInfo.ownerId ? currentIconUrl : '',
                currentAvatarThumbnailImageUrl: avatarInfo.ownerId ? currentIconUrl : '',
                previousCurrentAvatarImageUrl: previousAvatarInfo.ownerId ? previousIconUrl : '',
                previousCurrentAvatarThumbnailImageUrl: previousAvatarInfo.ownerId ? previousIconUrl : ''
            };
            notificationStore.queueFeedNoty(feed);
            sharedFeedStore.addEntry(feed);
            const persistedFeed = await database.addAvatarToDatabase(feed);
            if (persistedFeed) {
                feedStore.addFeedEntry(persistedFeed);
            }
        }
    }
    // if status is offline, ignore status and statusDescription
    if (
        (props.status && props.status[0] !== 'offline' && props.status[1] !== 'offline') ||
        (!props.status && props.statusDescription)
    ) {
        let status = '';
        let previousStatus = '';
        let statusDescription = '';
        let previousStatusDescription = '';
        if (props.status) {
            if (props.status[0]) {
                status = props.status[0];
            }
            if (props.status[1]) {
                previousStatus = props.status[1];
            }
        } else if (ref.status) {
            status = ref.status;
            previousStatus = ref.status;
        }
        if (props.statusDescription) {
            if (props.statusDescription[0]) {
                statusDescription = props.statusDescription[0];
            }
            if (props.statusDescription[1]) {
                previousStatusDescription = props.statusDescription[1];
            }
        } else if (ref.statusDescription) {
            statusDescription = ref.statusDescription;
            previousStatusDescription = ref.statusDescription;
        }
        feed = {
            created_at: nowIso(),
            type: 'Status',
            userId: ref.id,
            displayName: ref.displayName,
            status,
            statusDescription,
            previousStatus,
            previousStatusDescription
        };
        notificationStore.queueFeedNoty(feed);
        sharedFeedStore.addEntry(feed);
        const persistedFeed = await database.addStatusToDatabase(feed);
        if (persistedFeed) {
            feedStore.addFeedEntry(persistedFeed);
        }
    }
    if (props.note && props.note[0] !== null && props.note[0] !== props.note[1]) {
        checkNote(ref.id, props.note[0]);
    }
}

/**
 * @param {object} ctx
 * @param {string} newState
 * @param {string} location
 * @param {number} $location_at
 * @param {object} [options] Test seams.
 * @param {function} [options.now] Timestamp provider.
 * @param {function} [options.nowIso] ISO timestamp provider.
 */
async function runUpdateFriendDelayedCheckFlow(
    ctx,
    newState,
    location,
    $location_at,
    { now = Date.now, nowIso = () => new Date().toJSON() } = {}
) {
    const friendStore = useFriendStore();
    const feedStore = useFeedStore();
    const notificationStore = useNotificationStore();
    const sharedFeedStore = useSharedFeedStore();
    const { friends, localFavoriteFriends } = friendStore;

    let feed;
    let groupName;
    let worldName;
    const id = ctx.id;
    if (AppDebug.debugFriendState) {
        console.log(`${ctx.name} updateFriendState ${ctx.state} -> ${newState}`);
        if (typeof ctx.ref !== 'undefined' && location !== ctx.ref.location) {
            console.log(`${ctx.name} pendingOfflineLocation ${location} -> ${ctx.ref.location}`);
        }
    }
    if (!friends.has(id)) {
        console.log('Friend not found', id);
        return;
    }
    const isVIP = localFavoriteFriends.has(id);
    const ref = ctx.ref;
    if (ctx.state !== newState && typeof ctx.ref !== 'undefined') {
        if ((newState === 'offline' || newState === 'active') && ctx.state === 'online') {
            ctx.ref.$online_for = '';
            ctx.ref.$offline_for = now();
            ctx.ref.$active_for = '';
            if (newState === 'active') {
                ctx.ref.$active_for = now();
            }
            const ts = now();
            const time = ts - $location_at;
            worldName = await getWorldName(location);
            groupName = await getGroupName(location);
            feed = {
                created_at: nowIso(),
                type: 'Offline',
                userId: ref.id,
                displayName: ref.displayName,
                location,
                worldName,
                groupName,
                time
            };
            notificationStore.queueFeedNoty(feed);
            sharedFeedStore.addEntry(feed);
            const persistedFeed = await database.addOnlineOfflineToDatabase(feed);
            if (persistedFeed) {
                feedStore.addFeedEntry(persistedFeed);
            }
        } else if (newState === 'online' && (ctx.state === 'offline' || ctx.state === 'active')) {
            ctx.ref.$previousLocation = '';
            ctx.ref.$travelingToTime = now();
            ctx.ref.$location_at = now();
            ctx.ref.$online_for = now();
            ctx.ref.$offline_for = '';
            ctx.ref.$active_for = '';
            worldName = await getWorldName(location);
            groupName = await getGroupName(location);
            feed = {
                created_at: nowIso(),
                type: 'Online',
                userId: id,
                displayName: ctx.name,
                location,
                worldName,
                groupName,
                time: ''
            };
            notificationStore.queueFeedNoty(feed);
            sharedFeedStore.addEntry(feed);
            const persistedFeed = await database.addOnlineOfflineToDatabase(feed);
            if (persistedFeed) {
                feedStore.addFeedEntry(persistedFeed);
            }
        }
        if (newState === 'active') {
            ctx.ref.$active_for = now();
        }
    }
    if (ctx.state !== newState) {
        ctx.state = newState;
        friendStore.updateOnlineFriendCounter();
    }
    if (ref?.displayName) {
        ctx.name = ref.displayName;
        syncFriendSearchIndex(ctx);
    }
    ctx.isVIP = isVIP;
    friendStore.reindexSortedFriend(ctx);
}


  return {
    seed(entries){for(const entry of entries){const ref=entry.ref;cachedUsers.set(ref.id,ref);friends.set(ref.id,{id:ref.id,name:ref.displayName,ref,state:entry.state});}},
    snapshot(){return [...friends.values()].map(ctx=>({ref:ctx.ref,state:ctx.state}));},
    async observe(patch,at,{skipLocationFeed=false}={}){
      let ref=cachedUsers.get(patch.id),ctx=friends.get(patch.id);
      if(!ref){ref={id:patch.id,displayName:patch.displayName || patch.id,location:'offline',state:'offline',$location_at:at,$previousLocation:'',$travelingToTime:at};ctx={id:patch.id,name:ref.displayName,ref,state:'offline'};cachedUsers.set(patch.id,ref);friends.set(patch.id,ctx);}
      const previous={...ref},props={};
      for(const [key,value]of Object.entries(patch)){if(value!==undefined && JSON.stringify(ref[key])!==JSON.stringify(value)){props[key]=[value,ref[key]];ref[key]=value;}}
      if(props.location){props.location[2]=Math.max(0,at-(previous.$location_at || at));ref.$location_at=at;}
      if(skipLocationFeed)delete props.location;
      const state=patch.state || (patch.location==='offline'?'offline':patch.location && patch.location!=='offline'?'online':ctx.state);
      if(state!==ctx.state)props.state=[state,ctx.state];
      const now=()=>at,nowIso=()=>new Date(at).toISOString();
      await runHandleUserUpdateFlow(ref,props,{now,nowIso});
      await runUpdateFriendDelayedCheckFlow(ctx,state,state==='online'?ref.location:previous.location,previous.$location_at || at,{now,nowIso});
      if(props.bio){const existing=await database.getUserProfile(ref.id);if(existing && (existing.bio!==ref.bio || JSON.stringify(existing.bioLinks)!==JSON.stringify(ref.bioLinks || [])))await database.addBioToDatabase({created_at:nowIso(),userId:ref.id,displayName:ref.displayName,bio:ref.bio,previousBio:existing.bio,bioLinks:ref.bioLinks || [],previousBioLinks:existing.bioLinks});database.setUserProfile({...ref,bioLinks:ref.bioLinks || []});}
    }
  };
}
export function vrcxBioLinksDifference(previousLinks = [], links = []) {
    return [
        ...links.map((link) => ({
            link,
            className: previousLinks.includes(link) ? '' : 'x-text-added'
        })),
        ...previousLinks.filter((link) => !links.includes(link)).map((link) => ({ link, className: 'x-text-removed' }))
    ];
}

/**
 * Builds an HTML-escaped word diff of two strings, wrapping removed and added words in the given markers.
 *
 * @param {any} oldString
 * @param {any} newString
 * @param {string} [markerAddition] HTML template for added words; `{{text}}` is replaced with the words
 * @param {string} [markerDeletion] HTML template for removed words; `{{text}}` is replaced with the words
 * @returns {string} HTML string with newlines converted to `<br>`
 */
export function vrcxFeedDifference(
    oldString,
    newString,
    markerAddition = '<span class="x-text-added">{{text}}</span>',
    markerDeletion = '<span class="x-text-removed">{{text}}</span>'
) {
    [oldString, newString] = [oldString, newString].map((s) =>
        String(s ?? '')
            .replaceAll(/&/g, '&amp;')
            .replaceAll(/</g, '&lt;')
            .replaceAll(/>/g, '&gt;')
            .replaceAll(/"/g, '&quot;')
            .replaceAll(/'/g, '&#039;')
            .replaceAll(/\n/g, '<br>')
    );

    const oldWords = oldString.split(/\s+/).flatMap((word) => word.split(/(<br>)/));
    const newWords = newString.split(/\s+/).flatMap((word) => word.split(/(<br>)/));

    function findLongestMatch(oldStart, oldEnd, newStart, newEnd) {
        let bestOldStart = oldStart;
        let bestNewStart = newStart;
        let bestSize = 0;

        const lookup = new Map();
        for (let i = oldStart; i < oldEnd; i++) {
            const word = oldWords[i];
            if (!lookup.has(word)) lookup.set(word, []);
            lookup.get(word).push(i);
        }

        for (let j = newStart; j < newEnd; j++) {
            const word = newWords[j];
            if (!lookup.has(word)) continue;

            for (const i of lookup.get(word)) {
                let size = 0;
                while (i + size < oldEnd && j + size < newEnd && oldWords[i + size] === newWords[j + size]) {
                    size++;
                }
                if (size > bestSize) {
                    bestOldStart = i;
                    bestNewStart = j;
                    bestSize = size;
                }
            }
        }

        return {
            oldStart: bestOldStart,
            newStart: bestNewStart,
            size: bestSize
        };
    }

    function buildDiff(oldStart, oldEnd, newStart, newEnd) {
        const result = [];
        const match = findLongestMatch(oldStart, oldEnd, newStart, newEnd);

        if (match.size > 0) {
            // Handle differences before the match
            if (oldStart < match.oldStart || newStart < match.newStart) {
                result.push(...buildDiff(oldStart, match.oldStart, newStart, match.newStart));
            }

            // Add the matched words
            result.push(oldWords.slice(match.oldStart, match.oldStart + match.size).join(' '));

            // Handle differences after the match
            if (match.oldStart + match.size < oldEnd || match.newStart + match.size < newEnd) {
                result.push(...buildDiff(match.oldStart + match.size, oldEnd, match.newStart + match.size, newEnd));
            }
        } else {
            function build(words, start, end, pattern) {
                let r = [];
                let ts = words
                    .slice(start, end)
                    .filter((w) => w.length > 0)
                    .join(' ')
                    .split('<br>');
                for (let i = 0; i < ts.length; i++) {
                    if (i > 0) r.push('<br>');
                    if (ts[i].length < 1) continue;
                    r.push(pattern.replace('{{text}}', ts[i]));
                }
                return r;
            }

            // Add deletions
            if (oldStart < oldEnd) result.push(...build(oldWords, oldStart, oldEnd, markerDeletion));

            // Add insertions
            if (newStart < newEnd) result.push(...build(newWords, newStart, newEnd, markerAddition));
        }

        return result;
    }

    return buildDiff(0, oldWords.length, 0, newWords.length)
        .join(' ')
        .replace(/<br>[ ]+<br>/g, '<br><br>')
        .replace(/<br> /g, '<br>');
}

/**
 * Create a default world ref object.
 *
 * @param {Partial<import('@/types/vrcx').VrcxWorld>} json - API response to merge
 * @returns {import('@/types/vrcx').VrcxWorld}
 */
export function createVrcxWorldRef(json) {
    return /** @type {import('@/types/vrcx').VrcxWorld} */ ({
        id: '',
        name: '',
        description: '',
        defaultContentSettings: {},
        disabledPropAbilities: [],
        authorId: '',
        authorName: '',
        capacity: 0,
        recommendedCapacity: 0,
        tags: [],
        releaseStatus: '',
        imageUrl: '',
        thumbnailImageUrl: '',
        assetUrl: '',
        assetUrlObject: {},
        pluginUrl: '',
        pluginUrlObject: {},
        unityPackageUrl: '',
        unityPackageUrlObject: {},
        unityPackages: [],
        version: 0,
        favorites: 0,
        created_at: '',
        updated_at: '',
        publicationDate: '',
        labsPublicationDate: '',
        visits: 0,
        popularity: 0,
        heat: 0,
        publicOccupants: 0,
        privateOccupants: 0,
        occupants: 0,
        instances: [],
        featured: false,
        organization: '',
        previewYoutubeId: '',
        isHypeTrainEligible: false,
        namespace: '',
        slimInstances: [],
        storeId: '',
        udonProducts: [],
        urlList: [],
        // VRCX
        $isLabs: false,
        //
        ...json
    });
}

/**
 * Create a default avatar ref object.
 *
 * @param {Partial<import('@/types/vrcx').Json<import('vrchat').Avatar>>} json - API response to merge
 * @returns {import('@/types/vrcx').Json<import('vrchat').Avatar>}
 */
export function createVrcxAvatarRef(json) {
    return /** @type {import('@/types/vrcx').Json<import('vrchat').Avatar>} */ ({
        acknowledgements: '',
        activeAssetReviewId: '',
        assetUrl: '',
        assetUrlObject: {},
        attribution: null,
        authorId: '',
        authorName: '',
        created_at: '',
        description: '',
        featured: false,
        highestPrice: null,
        id: '',
        imageUrl: '',
        listingDate: null,
        lock: false,
        lowestPrice: null,
        name: '',
        pendingUpload: false,
        performance: {},
        productId: null,
        publishedListings: [],
        releaseStatus: '',
        searchable: false,
        styles: [],
        tags: [],
        thumbnailImageUrl: '',
        unityPackageUrl: '',
        unityPackageUrlObject: {},
        unityPackages: [],
        updated_at: '',
        version: 0,
        ...json
    });
}

export function vrcxReplaceBioSymbols(text) {
    if (typeof text !== 'string') {
        return '';
    }
    const symbolList = {
        '@': '＠',
        '#': '＃',
        $: '＄',
        '%': '％',
        '&': '＆',
        '=': '＝',
        '+': '＋',
        '/': '⁄',
        '\\': '＼',
        ';': ';',
        ':': '˸',
        ',': '‚',
        '?': '？',
        '!': 'ǃ',
        '"': '＂',
        '<': '≺',
        '>': '≻',
        '.': '․',
        '^': '＾',
        '{': '｛',
        '}': '｝',
        '[': '［',
        ']': '］',
        '(': '（',
        ')': '）',
        '|': '｜',
        '*': '∗'
    };
    let newText = text;
    for (const key in symbolList) {
        const regex = new RegExp(symbolList[key], 'g');
        newText = newText.replace(regex, key);
    }
    return newText.replace(/ {1,}/g, ' ').trimRight();
}


/**
 * @param {string} s
 * @returns {string}
 */
export function vrcxExtractFileId(s) {
    const match = String(s).match(/file_[0-9A-Za-z-]+/);
    return match ? match[0] : '';
}

/**
 * @param {string} s
 * @returns {string}
 */
function extractFileVersion(s) {
    const match = /(?:\/file_[0-9A-Za-z-]+\/)([0-9]+)/gi.exec(s);
    return match ? match[1] : '';
}

/**
 * @param {string} url
 * @returns {string}
 */
function extractVariantVersion(url) {
    if (!url) {
        return '0';
    }
    try {
        const params = new URLSearchParams(new URL(url).search);
        const version = params.get('v');
        if (version) {
            return version;
        }
        return '0';
    } catch {
        return '0';
    }
}


/**
 * @param {object} args
 * @param {Map} cachedAvatarNames
 * @returns
 */
export function vrcxStoreAvatarImage(args, cachedAvatarNames) {
    const refCreatedAt = args.json.versions[0];
    const fileCreatedAt = refCreatedAt.created_at;
    const fileId = args.params.fileId;
    let avatarName = '';
    const imageName = args.json.name;
    const avatarNameRegex = /Avatar - (.*) - Image -/gi.exec(imageName);
    if (avatarNameRegex) {
        avatarName = vrcxReplaceBioSymbols(avatarNameRegex[1]);
    }
    const ownerId = args.json.ownerId;
    const avatarInfo = {
        ownerId,
        avatarName,
        fileCreatedAt
    };
    cachedAvatarNames.set(fileId, avatarInfo);
    return avatarInfo;
}

/**
 * @param {string} avatar
 * @returns {string | null}
 */
function parseAvatarUrl(avatar) {
    const url = new URL(avatar);
    const urlPath = url.pathname;
    if (urlPath.substring(5, 13) === '/avatar/') {
        const avatarId = urlPath.substring(13);
        return avatarId;
    }
    return null;
}

/**
 * @param {object} unityPackages
 * @returns
 */
export function vrcxAvatarPlatforms(unityPackages) {
    let pc = {};
    let android = {};
    let ios = {};
    if (typeof unityPackages === 'object') {
        for (const unityPackage of unityPackages) {
            if (unityPackage.variant && unityPackage.variant !== 'standard' && unityPackage.variant !== 'security') {
                continue;
            }
            if (unityPackage.platform === 'standalonewindows') {
                if (unityPackage.performanceRating === 'None' && pc.performanceRating) {
                    continue;
                }
                pc = unityPackage;
            } else if (unityPackage.platform === 'android') {
                if (unityPackage.performanceRating === 'None' && android.performanceRating) {
                    continue;
                }
                android = unityPackage;
            } else if (unityPackage.platform === 'ios') {
                if (unityPackage.performanceRating === 'None' && ios.performanceRating) {
                    continue;
                }
                ios = unityPackage;
            }
        }
    }
    return { pc, android, ios };
}

/**
 * @param {string} unitySortNumber
 * @param {string} [sdkUnityVersion]
 * @returns {boolean}
 */
function compareUnityVersion(unitySortNumber, sdkUnityVersion) {
    if (!sdkUnityVersion) {
        console.error('No sdkUnityVersion provided');
        return false;
    }

    // 2022.3.6f1  2022 03 06 000
    // 2019.4.31f1 2019 04 31 000
    // 5.3.4p1     5    03 04 010
    // 2019.4.31f1c1 is a thing
    const array = sdkUnityVersion.split('.');
    if (array.length < 3) {
        console.error('Invalid sdkUnityVersion');
        return false;
    }
    let currentUnityVersion = array[0];
    currentUnityVersion += array[1].padStart(2, '0');
    const indexFirstLetter = array[2].search(/[a-zA-Z]/);
    if (indexFirstLetter > -1) {
        currentUnityVersion += array[2].substr(0, indexFirstLetter).padStart(2, '0');
        currentUnityVersion += '0';
        const letter = array[2].substr(indexFirstLetter, 1);
        if (letter === 'p') {
            currentUnityVersion += '1';
        } else {
            // f
            currentUnityVersion += '0';
        }
        currentUnityVersion += '0';
    } else {
        // just in case
        currentUnityVersion += '000';
    }
    // just in case
    currentUnityVersion = currentUnityVersion.replace(/\D/g, '');

    if (parseInt(unitySortNumber, 10) <= parseInt(currentUnityVersion, 10)) {
        return true;
    }
    return false;
}


export function vrcxComputeTrustLevel(tags, developerType) {
    let isModerator = Boolean(developerType) && developerType !== 'none';
    let isTroll = false;
    let isProbableTroll = false;
    let trustLevel = 'Visitor';
    let trustClass = 'x-tag-untrusted';
    let trustColorKey = 'untrusted';
    let trustSortNum = 1;

    if (tags.includes('admin_moderator')) {
        isModerator = true;
    }
    if (tags.includes('system_troll')) {
        isTroll = true;
    }
    if (tags.includes('system_probable_troll') && !isTroll) {
        isProbableTroll = true;
    }

    if (tags.includes('system_trust_veteran')) {
        trustLevel = 'Trusted User';
        trustClass = 'x-tag-veteran';
        trustColorKey = 'veteran';
        trustSortNum = 5;
    } else if (tags.includes('system_trust_trusted')) {
        trustLevel = 'Known User';
        trustClass = 'x-tag-trusted';
        trustColorKey = 'trusted';
        trustSortNum = 4;
    } else if (tags.includes('system_trust_known')) {
        trustLevel = 'User';
        trustClass = 'x-tag-known';
        trustColorKey = 'known';
        trustSortNum = 3;
    } else if (tags.includes('system_trust_basic')) {
        trustLevel = 'New User';
        trustClass = 'x-tag-basic';
        trustColorKey = 'basic';
        trustSortNum = 2;
    }

    if (isTroll || isProbableTroll) {
        trustColorKey = 'troll';
        trustSortNum += 0.1;
    }
    if (isModerator) {
        trustColorKey = 'vip';
        trustSortNum += 0.3;
    }

    return {
        trustLevel,
        trustClass,
        trustSortNum,
        isModerator,
        isTroll,
        isProbableTroll,
        trustColorKey
    };
}


export function vrcxParseLocation(tag) {
    let _tag = String(tag || '');
    const ctx = {
        tag: _tag,
        isOffline: false,
        isPrivate: false,
        isTraveling: false,
        isRealInstance: false,
        worldId: '',
        instanceId: '',
        instanceName: '',
        accessType: '',
        accessTypeName: '',
        region: '',
        shortName: '',
        userId: null,
        hiddenId: null,
        privateId: null,
        friendsId: null,
        groupId: null,
        groupAccessType: null,
        canRequestInvite: false,
        strict: false,
        ageGate: false
    };
    if (_tag === 'offline' || _tag === 'offline:offline') {
        ctx.isOffline = true;
    } else if (_tag === 'private' || _tag === 'private:private') {
        ctx.isPrivate = true;
    } else if (_tag === 'traveling' || _tag === 'traveling:traveling') {
        ctx.isTraveling = true;
    } else if (tag && !_tag.startsWith('local')) {
        ctx.isRealInstance = true;
        const sep = _tag.indexOf(':');
        // technically not part of instance id, but might be there when coping id from url so why not support it
        const shortNameQualifier = '&shortName=';
        const shortNameIndex = _tag.indexOf(shortNameQualifier);
        if (shortNameIndex >= 0) {
            ctx.shortName = _tag.substr(shortNameIndex + shortNameQualifier.length);
            _tag = _tag.substr(0, shortNameIndex);
        }
        if (sep >= 0) {
            ctx.worldId = _tag.substr(0, sep);
            ctx.instanceId = _tag.substr(sep + 1);
            ctx.instanceId.split('~').forEach((s, i) => {
                if (i) {
                    const A = s.indexOf('(');
                    const Z = A >= 0 ? s.lastIndexOf(')') : -1;
                    const key = Z >= 0 ? s.substr(0, A) : s;
                    const value = A < Z ? s.substr(A + 1, Z - A - 1) : '';
                    if (key === 'hidden') {
                        ctx.hiddenId = value;
                    } else if (key === 'private') {
                        ctx.privateId = value;
                    } else if (key === 'friends') {
                        ctx.friendsId = value;
                    } else if (key === 'canRequestInvite') {
                        ctx.canRequestInvite = true;
                    } else if (key === 'region') {
                        ctx.region = value;
                    } else if (key === 'group') {
                        ctx.groupId = value;
                    } else if (key === 'groupAccessType') {
                        ctx.groupAccessType = value;
                    } else if (key === 'strict') {
                        ctx.strict = true;
                    } else if (key === 'ageGate') {
                        ctx.ageGate = true;
                    }
                } else {
                    ctx.instanceName = s;
                }
            });
            ctx.accessType = 'public';
            if (ctx.privateId !== null) {
                if (ctx.canRequestInvite) {
                    // InvitePlus
                    ctx.accessType = 'invite+';
                } else {
                    // InviteOnly
                    ctx.accessType = 'invite';
                }
                ctx.userId = ctx.privateId;
            } else if (ctx.friendsId !== null) {
                // FriendsOnly
                ctx.accessType = 'friends';
                ctx.userId = ctx.friendsId;
            } else if (ctx.hiddenId !== null) {
                // FriendsOfGuests
                ctx.accessType = 'friends+';
                ctx.userId = ctx.hiddenId;
            } else if (ctx.groupId !== null) {
                // Group
                ctx.accessType = 'group';
            }
            ctx.accessTypeName = ctx.accessType;
            if (ctx.groupAccessType !== null) {
                if (ctx.groupAccessType === 'public') {
                    ctx.accessTypeName = 'groupPublic';
                } else if (ctx.groupAccessType === 'plus') {
                    ctx.accessTypeName = 'groupPlus';
                }
            }
        } else {
            ctx.worldId = _tag;
        }
    }
    return ctx;
}


export function vrcxFeedFilterChange(current, value, feedFilterTypes = ['GPS', 'Online', 'Offline', 'Status', 'Avatar', 'Bio']) {
        let filter = [];
        const selected = Array.isArray(value) ? value : [];
        const wasAll = (current.length ? current : ['All']).includes('All');
        const hasAll = selected.includes('All');
        const types = selected.filter((v) => v !== 'All');

        if (hasAll && !wasAll) {
            filter = [];
        } else if (wasAll && types.length) {
            filter = types;
        } else {
            filter = types.length === feedFilterTypes.length ? [] : types.length ? types : [];
        }
        return filter;
    }
