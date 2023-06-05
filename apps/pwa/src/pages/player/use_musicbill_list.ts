import { useState, useEffect, useCallback, useMemo } from 'react';
import DefaultCover from '@/asset/default_cover.jpeg';
import { RequestStatus } from '@/constants';
import getMusicbillListRequest from '@/server/api/get_musicbill_list';
import addMusicToMusicbill from '@/server/api/add_music_to_musicbill';
import removeMusicFromMusicbill from '@/server/api/remove_music_from_musicbill';
import logger from '@/utils/logger';
import dialog from '@/utils/dialog';
import getMusicbill from '@/server/api/get_musicbill';
import p from '@/global_states/profile';
import notice from '@/utils/notice';
import { ExceptionCode } from '#/constants/exception';
import eventemitter, { EventType } from './eventemitter';
import { Musicbill } from './constants';

export default () => {
  const [status, setStatus] = useState(RequestStatus.LOADING);
  const [musicbillList, setMusicbillList] = useState<Musicbill[]>([]);
  const getMusicbillList = useCallback(async (silence) => {
    if (!silence) {
      setStatus(RequestStatus.LOADING);
    }
    try {
      const mbl = await getMusicbillListRequest();
      setMusicbillList(
        mbl.map((mb) => ({
          id: mb.id,
          name: mb.name,
          cover: mb.cover || DefaultCover,
          createTimestamp: mb.createTimestamp,
          public: !!mb.public,
          owner: mb.owner,
          sharedUserList: mb.sharedUserList,

          musicList: [],

          status: RequestStatus.NOT_START,
          error: null,
        })),
      );
      setStatus(RequestStatus.SUCCESS);
    } catch (error) {
      logger.error(error, '获取乐单列表失败');
      dialog.alert({
        title: '获取乐单列表失败',
        content: error.message,
      });
      setStatus(RequestStatus.ERROR);
    }
  }, []);

  useEffect(() => {
    const unlistenFetchMusicbill = eventemitter.listen(
      EventType.FETCH_MUSICBILL_DETAIL,
      async ({ id, silence }) => {
        if (!silence) {
          setMusicbillList((mbl) =>
            mbl.map((mb) => {
              if (mb.id === id) {
                return {
                  ...mb,
                  status: RequestStatus.LOADING,
                  error: null,
                };
              }
              return mb;
            }),
          );
        }
        try {
          const data = await getMusicbill(id);
          setMusicbillList((mbl) =>
            mbl.map((mb) => {
              if (mb.id === id) {
                return {
                  ...mb,
                  name: data.name,
                  cover: data.cover || mb.cover || DefaultCover,
                  public: data.public,
                  owner: data.owner,
                  sharedUserList: data.sharedUserList,
                  musicList: data.musicList.map((m, index) => ({
                    ...m,
                    index: data.musicList.length - index,
                  })),

                  status: RequestStatus.SUCCESS,
                };
              }
              return mb;
            }),
          );
        } catch (error) {
          logger.error(error, '获取自己的歌单详情失败');
          setMusicbillList((mbl) =>
            mbl.map((mb) => {
              if (mb.id === id) {
                return {
                  ...mb,
                  status: RequestStatus.ERROR,
                  error,
                };
              }
              return mb;
            }),
          );
        }
      },
    );
    const unlistenAddMusicToMusicbill = eventemitter.listen(
      EventType.ADD_MUSIC_TO_MUSICBILL,
      async ({ musicbill, music }) => {
        const { id: musicbillId } = musicbill;
        const { id: musicId } = music;
        setMusicbillList((mbl) =>
          mbl.map((mb) => {
            if (mb.id === musicbillId) {
              const musicList = [{ ...music, index: 0 }, ...mb.musicList];
              const { length } = musicList;
              return {
                ...mb,
                musicList: musicList.map((m, index) => ({
                  ...m,
                  index: length - index,
                })),
              };
            }
            return mb;
          }),
        );
        try {
          await addMusicToMusicbill(musicbillId, musicId);
        } catch (error) {
          logger.error(error, '添加音乐到乐单失败');
          if (error.code !== ExceptionCode.MUSIC_IN_MUSICBILL_ALREADY) {
            notice.error(error.message);
            setMusicbillList((mbl) =>
              mbl.map((mb) => {
                if (mb.id === musicbillId) {
                  const musicList = mb.musicList.filter(
                    (m) => m.id !== musicId,
                  );
                  const { length } = musicList;
                  return {
                    ...mb,
                    musicList: musicList.map((m, index) => ({
                      ...m,
                      index: length - index,
                    })),
                  };
                }
                return mb;
              }),
            );
          }
        }
      },
    );
    const unlistenRemoveMusicFromMusicbill = eventemitter.listen(
      EventType.REMOVE_MUSIC_FROM_MUSICBILL,
      async ({ musicbill, music }) => {
        const { id: musicbillId } = musicbill;
        const { id: musicId } = music;
        setMusicbillList((mbl) =>
          mbl.map((mb) => {
            if (mb.id === musicbillId) {
              const musicList = mb.musicList.filter((m) => m.id !== musicId);
              const { length } = musicList;
              return {
                ...mb,
                musicList: musicList.map((m, index) => ({
                  ...m,
                  index: length - index,
                })),
              };
            }
            return mb;
          }),
        );
        try {
          await removeMusicFromMusicbill(musicbillId, musicId);
        } catch (error) {
          logger.error(error, '从乐单移除音乐失败');
          if (error.code !== ExceptionCode.MUSIC_NOT_IN_MUSICBILL) {
            notice.error(error.message);
            setMusicbillList((mbl) =>
              mbl.map((mb) => {
                if (mb.id === musicbillId) {
                  const musicList = [{ ...music, index: 0 }, ...mb.musicList];
                  const { length } = musicList;
                  return {
                    ...mb,
                    musicList: musicList.map((m, index) => ({
                      ...m,
                      index: length - index,
                    })),
                  };
                }
                return mb;
              }),
            );
          }
        }
      },
    );
    return () => {
      unlistenFetchMusicbill();
      unlistenAddMusicToMusicbill();
      unlistenRemoveMusicFromMusicbill();
    };
  }, []);

  const profile = p.useState()!;
  const sortedMusicbillList = useMemo(() => {
    const orders = profile.musicbillOrders;
    return musicbillList.sort((a, b) => {
      const aOrder = orders.indexOf(a.id);
      const bOrder = orders.indexOf(b.id);
      return (
        (aOrder === -1 ? Infinity : aOrder) -
        (bOrder === -1 ? Infinity : bOrder)
      );
    });
  }, [musicbillList, profile.musicbillOrders]);

  useEffect(() => {
    const reloadMusicbillList = () => getMusicbillList(false);
    const reloadMusicbillListSilently = () => getMusicbillList(true);

    reloadMusicbillList();

    const unlistenReloadMusicbillList = eventemitter.listen(
      EventType.RELOAD_MUSICBILL_LIST,
      (payload) =>
        payload.silence ? reloadMusicbillListSilently() : reloadMusicbillList(),
    );
    const unlistenMusicUpdated = eventemitter.listen(
      EventType.MUSIC_UPDATED,
      reloadMusicbillListSilently,
    );
    const unlistenMusicDeleted = eventemitter.listen(
      EventType.MUSIC_DELETED,
      reloadMusicbillListSilently,
    );
    const unlistenSingerUpdated = eventemitter.listen(
      EventType.SINGER_UPDATED,
      reloadMusicbillListSilently,
    );
    const unlistenMusicbillCreated = eventemitter.listen(
      EventType.MUSICBILL_CREATED,
      reloadMusicbillList,
    );
    const unlistenMusicbillDeleted = eventemitter.listen(
      EventType.MUSICBILL_DELETED,
      reloadMusicbillList,
    );
    return () => {
      unlistenReloadMusicbillList();
      unlistenMusicUpdated();
      unlistenMusicDeleted();
      unlistenSingerUpdated();
      unlistenMusicbillCreated();
      unlistenMusicbillDeleted();
    };
  }, [getMusicbillList]);

  return {
    status,
    musicbillList: sortedMusicbillList,
  };
};
